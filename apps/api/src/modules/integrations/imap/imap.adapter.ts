import { Logger } from '@nestjs/common'
import { ImapFlow } from 'imapflow'
import { RawEmail } from '../gmail/gmail.adapter'

export interface ImapConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  /** OAuth2 access token — when provided, XOAUTH2 is used instead of password */
  accessToken?: string
}

export class ImapAdapter {
  private readonly logger = new Logger(ImapAdapter.name)

  constructor(private readonly config: ImapConfig) {}

  private createClient(): ImapFlow {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      // Use XOAUTH2 when an OAuth2 access token is provided (e.g. Microsoft/O365)
      auth: this.config.accessToken
        ? { user: this.config.user, accessToken: this.config.accessToken }
        : { user: this.config.user, pass: this.config.password },
      logger: false,
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 15000,
    })
    // Prevent unhandled 'error' events from crashing the process
    client.on('error', (err: Error) => {
      this.logger.warn(`ImapFlow error event: ${err.message}`)
    })
    return client
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const client = this.createClient()
    let lastError = ''
    client.on('error', (err: Error) => { lastError = err.message || String(err) })
    try {
      await client.connect()
      await client.logout()
      return { success: true }
    } catch (err: any) {
      try { client.close() } catch {}
      const msg = this.extractErrorMessage(err) || lastError || 'Connection failed'
      return { success: false, error: msg }
    }
  }

  private extractErrorMessage(err: any): string {
    if (!err) return ''
    // AggregateError — unwrap inner errors
    if (err.errors?.length) {
      return err.errors.map((e: any) => e?.message || String(e)).join('; ')
    }
    return err.message || err.responseText || err.code || String(err)
  }

  /**
   * List recent inbox emails for scanning.
   * Prefers unread first; if none, falls back to the most recent N messages
   * (already-read messages are common when users open mail on phone/web first).
   * Dedup against ProcessedEmail happens in the service layer.
   */
  async listUnread(maxResults = 30): Promise<RawEmail[]> {
    const client = this.createClient()
    const emails: RawEmail[] = []

    try {
      await client.connect()
      const lock = await client.mailboxOpen('INBOX')
      const total = lock.exists ?? 0
      this.logger.log(`IMAP INBOX opened for ${this.config.user} — ${total} messages`)

      if (total === 0) {
        await client.logout()
        return []
      }

      // 1) Try unread + unanswered UIDs first (skip emails already replied to)
      let range: string | number[] = []
      let mode = 'unread'
      try {
        const unreadUids = await client.search({ seen: false, answered: false }, { uid: true })
        this.logger.log(`IMAP unread+unanswered count for ${this.config.user}: ${unreadUids?.length ?? 0}`)
        if (unreadUids?.length) {
          range = unreadUids.slice(-maxResults)
          mode = 'unread'
        } else {
          // 2) Fall back to unanswered messages (read on phone/web but not replied to)
          const unansweredUids = await client.search({ answered: false }, { uid: true })
          this.logger.log(`IMAP unanswered fallback count for ${this.config.user}: ${unansweredUids?.length ?? 0}`)
          if (unansweredUids?.length) {
            range = unansweredUids.slice(-maxResults)
            mode = 'unanswered'
          } else {
            this.logger.log(`IMAP no unread or unanswered messages for ${this.config.user}`)
            await client.logout()
            return []
          }
        }
      } catch {
        // Server does not support ANSWERED search — fall back to last N by sequence
        const start = Math.max(1, total - maxResults + 1)
        range = Array.from({ length: total - start + 1 }, (_, i) => start + i)
        mode = 'recent-fallback'
      }

      const messages = client.fetch(
        range as any,
        {
          uid: true,
          flags: true,
          envelope: true,
          bodyStructure: true,
          source: true,
        },
        { uid: true },
      )

      for await (const msg of messages) {
        try {
          const email = await this.parseMessage(msg)
          if (email) emails.push(email)
        } catch (err: any) {
          this.logger.warn(`IMAP skip message: ${this.extractErrorMessage(err)}`)
        }
      }

      // Newest first
      emails.reverse()
      this.logger.log(`IMAP fetched ${emails.length} email(s) via ${mode} for ${this.config.user}`)

      await client.logout()
    } catch (err: any) {
      const msg = this.extractErrorMessage(err)
      this.logger.error(`IMAP listUnread failed: ${msg}`)
      try { client.close() } catch {}
      // Re-throw so the service can surface the error to the UI
      throw new Error(`IMAP fetch failed for ${this.config.user}: ${msg}`)
    }

    return emails
  }

  private async parseMessage(msg: any): Promise<RawEmail | null> {
    try {
      const env = msg.envelope
      const from = env?.from?.[0]

      // ImapFlow exposes from.address (full address) — use it directly
      // Fallback: construct from mailbox+host if address is missing (some servers)
      let fromEmail = from?.address || ''
      if (!fromEmail && from?.mailbox && from?.host) {
        fromEmail = `${from.mailbox}@${from.host}`
      }
      if (!fromEmail || fromEmail.includes('undefined') || !fromEmail.includes('@')) {
        this.logger.warn(`Skipping email with unresolvable sender: ${JSON.stringify(from)}`)
        return null
      }

      const fromName = (from?.name && from.name !== 'undefined') ? from.name : fromEmail

      const rawStr: string = msg.source ? msg.source.toString('utf8') : ''

      // Parse raw headers section for fields ENVELOPE may omit
      const headerSection = rawStr.split(/\r?\n\r?\n/)[0] ?? ''
      const getRawHeader = (name: string): string => {
        const m = headerSection.match(new RegExp(`^${name}:\\s*(.+?)(?=\\r?\\n(?!\\s)|$)`, 'im'))
        return m?.[1]?.trim() ?? ''
      }

      // Prefer raw header for Message-ID — ImapFlow envelope strips angle brackets
      // which are required by RFC 2822 for In-Reply-To / References threading headers.
      const rawMessageId = getRawHeader('Message-ID')
      const envelopeMessageId = env?.messageId
        ? (env.messageId.startsWith('<') ? env.messageId : `<${env.messageId}>`)
        : ''
      const messageId: string = rawMessageId || envelopeMessageId || `<imap-${msg.uid ?? Date.now()}@local>`
      const inReplyToRaw = getRawHeader('In-Reply-To')
      const referencesRaw = getRawHeader('References')

      // Parse To: and Cc: for Reply All support
      const parseAddressList = (header: string): string[] => {
        if (!header) return []
        return header
          .split(',')
          .map(a => {
            // Extract bare email from "Name <email>" or "email"
            const m = a.match(/<([^>]+)>/) ?? a.match(/([^\s,]+@[^\s,]+)/)
            return m?.[1]?.trim() ?? ''
          })
          .filter(a => a.includes('@'))
      }
      const toRaw = getRawHeader('To')
      const ccRaw = getRawHeader('Cc')
      const toAddresses = parseAddressList(toRaw)
      const ccAddresses = parseAddressList(ccRaw)

      const body = rawStr ? this.extractTextFromRaw(rawStr) : ''
      const uid = msg.uid ?? msg.seq ?? String(Date.now())

      // Map ImapFlow flags Set to labelIds array so callers can check \\Answered etc.
      const labelIds: string[] = msg.flags ? [...(msg.flags as Set<string>)] : []

      return {
        id: `imap-${uid}`,
        threadId: messageId,
        from: fromEmail,
        fromName,
        subject: env?.subject ?? '(no subject)',
        body: body.slice(0, 4000),
        receivedAt: env?.date ? new Date(env.date) : new Date(),
        snippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
        labelIds,
        to: toAddresses.length ? toAddresses : undefined,
        cc: ccAddresses.length ? ccAddresses : undefined,
        inReplyTo: inReplyToRaw || undefined,
        references: referencesRaw ? referencesRaw.split(/\s+/).filter(Boolean) : undefined,
      }
    } catch {
      return null
    }
  }

  private extractTextFromRaw(raw: string): string {
    // Split headers from body
    const bodyStart = raw.indexOf('\r\n\r\n')
    if (bodyStart === -1) return raw.slice(0, 2000)

    let body = raw.slice(bodyStart + 4)

    // Base64 decode if needed
    if (raw.toLowerCase().includes('content-transfer-encoding: base64')) {
      try {
        body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8')
      } catch {}
    }

    // Quoted-printable decode basic
    if (raw.toLowerCase().includes('content-transfer-encoding: quoted-printable')) {
      body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
    }

    // Strip HTML tags
    body = body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

    return body
  }

  async markAsRead(uid: string): Promise<void> {
    const client = this.createClient()
    client.on('error', () => {})
    try {
      await client.connect()
      await client.mailboxOpen('INBOX')
      const uidNum = parseInt(uid.replace('imap-', ''))
      if (!isNaN(uidNum)) {
        // Set both \\Seen and \\Answered so future scans skip this message
        await client.messageFlagsAdd({ uid: `${uidNum}` }, ['\\Seen', '\\Answered'], { uid: true })
      }
      await client.logout()
    } catch (err: any) {
      this.logger.warn(`markAsRead failed: ${this.extractErrorMessage(err)}`)
    } finally {
      try { client.close() } catch {}
    }
  }

  /**
   * Save a copy of a sent reply to the account's Sent folder via IMAP APPEND.
   * Without this, email clients cannot reconstruct the full thread.
   */
  async saveSent(params: {
    to: string
    subject: string
    htmlBody: string
    messageId: string    // the Message-ID header of the email that was just sent
    inReplyTo?: string
    references?: string[]
    fromName?: string
    cc?: string[]
  }): Promise<boolean> {
    const { to, subject, htmlBody, messageId, inReplyTo, references, fromName, cc } = params
    if (!to || !to.includes('@')) return false

    const client = this.createClient()
    client.on('error', (err: Error) => { this.logger.warn(`saveSent IMAP error: ${err.message}`) })
    try {
      await client.connect()
      const mailboxes = await client.list()
      const sentFolder = mailboxes.find(m =>
        m.flags.has('\\Sent') ||
        /^(Sent|Sent Items|Sent Messages|INBOX\.Sent)$/i.test(m.path)
      )
      const folder = sentFolder?.path ?? 'Sent'
      this.logger.log(`saveSent: saving to folder "${folder}" for <${to}>`)

      const boundary = `boundary_${Date.now()}`
      const plainText = htmlBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      const refChain = [...(references ?? []), ...(inReplyTo ? [inReplyTo] : [])]
        .filter((v, i, a) => v && a.indexOf(v) === i)
      const fromDisplay = fromName ? `"${fromName}" <${this.config.user}>` : this.config.user
      const dateStr = new Date().toUTCString()

      const ccList = (cc ?? []).filter(a => a && a.includes('@') && a.toLowerCase() !== this.config.user.toLowerCase())
      const rawMessage = [
        `From: ${fromDisplay}`,
        `To: ${to}`,
        ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
        `Date: ${dateStr}`,
        `Message-ID: ${messageId}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
        ...(refChain.length ? [`References: ${refChain.join(' ')}`] : []),
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        plainText,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        htmlBody,
        ``,
        `--${boundary}--`,
      ].join('\r\n')

      try {
        await client.append(folder, Buffer.from(rawMessage), ['\\Seen'])
      } catch (appendErr: any) {
        if (!appendErr.message?.includes('BigInt')) throw appendErr
      }
      try { await client.logout() } catch {}
      this.logger.log(`saveSent: ✅ Saved to "${folder}" Message-ID: ${messageId}`)
      return true
    } catch (err: any) {
      this.logger.warn(`saveSent: ❌ failed — ${this.extractErrorMessage(err)}`)
      try { client.close() } catch {}
      return false
    }
  }

  async saveDraft(to: string, subject: string, htmlBody: string, threadId?: string, references?: string[]): Promise<boolean> {
    if (!to || to.includes('undefined') || !to.includes('@')) {
      this.logger.warn(`saveDraft skipped — invalid recipient: "${to}"`)
      return false
    }
    const client = this.createClient()
    client.on('error', (err: Error) => { this.logger.warn(`saveDraft IMAP error: ${err.message}`) })
    try {
      this.logger.log(`saveDraft: connecting to ${this.config.host}:${this.config.port} as ${this.config.user}`)
      await client.connect()
      this.logger.log(`saveDraft: connected, listing mailboxes`)

      // Find Drafts folder
      const mailboxes = await client.list()
      this.logger.log(`saveDraft: mailboxes = ${mailboxes.map(m => m.path).join(', ')}`)
      const draftsFolder = mailboxes.find(m =>
        m.flags.has('\\Drafts') ||
        /^(Drafts|Draft|INBOX\.Drafts|INBOX\.Draft)$/i.test(m.path)
      )
      const folder = draftsFolder?.path ?? 'Drafts'
      this.logger.log(`saveDraft: using folder "${folder}"`)

      // Build raw RFC 2822 message
      const boundary = `boundary_${Date.now()}`
      const plainText = htmlBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      // Build full References chain: prior chain + the immediate parent (deduplicated)
      const refChain = [...(references ?? []), ...(threadId ? [threadId] : [])]
        .filter((v, i, a) => v && a.indexOf(v) === i)
      const rawMessage = [
        `From: ${this.config.user}`,
        `To: ${to}`,
        `Subject: Re: ${subject.startsWith('Re:') ? subject.slice(4).trim() : subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        `X-Draft: true`,
        ...(threadId ? [`In-Reply-To: ${threadId}`] : []),
        ...(refChain.length ? [`References: ${refChain.join(' ')}`] : []),
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        plainText,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        htmlBody,
        ``,
        `--${boundary}--`,
      ].join('\r\n')

      this.logger.log(`saveDraft: appending ${rawMessage.length} bytes to "${folder}"`)
      try {
        await client.append(folder, Buffer.from(rawMessage), ['\\Draft', '\\Seen'])
      } catch (appendErr: any) {
        // ImapFlow v1.4+ returns UID as BigInt in the APPENDUID response.
        // JSON.stringify inside ImapFlow's response parser throws "Do not know how
        // to serialize a BigInt" — but the APPEND command already completed on the
        // server, so the draft WAS saved. Treat this as success.
        if (!appendErr.message?.includes('BigInt')) {
          throw appendErr
        }
        this.logger.warn(`saveDraft: BigInt serialization warning (harmless — draft was saved)`)
      }
      try { await client.logout() } catch {}
      this.logger.log(`saveDraft: ✅ Draft saved to "${folder}" for <${to}>`)
      return true
    } catch (err: any) {
      const msg = this.extractErrorMessage(err)
      this.logger.warn(`saveDraft: ❌ failed — ${msg}`)
      try { client.close() } catch {}
      return false
    }
  }

  async archiveEmail(uid: string): Promise<void> {
    await this.markAsRead(uid)
  }
}
