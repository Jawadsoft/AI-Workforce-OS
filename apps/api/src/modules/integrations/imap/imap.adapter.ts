import { Logger } from '@nestjs/common'
import { ImapFlow } from 'imapflow'
import { RawEmail } from '../gmail/gmail.adapter'

export interface ImapConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

export class ImapAdapter {
  private readonly logger = new Logger(ImapAdapter.name)

  constructor(private readonly config: ImapConfig) {}

  private createClient(): ImapFlow {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
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

      // 1) Try unread UIDs first
      let range: string | number[] | { seen: false } = { seen: false }
      let mode = 'unread'
      try {
        const unreadUids = await client.search({ seen: false }, { uid: true })
        this.logger.log(`IMAP unread count for ${this.config.user}: ${unreadUids?.length ?? 0}`)
        if (unreadUids?.length) {
          range = unreadUids.slice(-maxResults)
          mode = 'unread'
        } else {
          // 2) Fall back to last N messages by sequence number (includes already-read)
          const start = Math.max(1, total - maxResults + 1)
          range = `${start}:${total}`
          mode = 'recent'
          this.logger.log(`IMAP falling back to recent sequence ${range} for ${this.config.user}`)
        }
      } catch {
        const start = Math.max(1, total - maxResults + 1)
        range = `${start}:${total}`
        mode = 'recent'
      }

      const useUid = Array.isArray(range)
      const messages = client.fetch(
        range as any,
        {
          uid: true,
          flags: true,
          envelope: true,
          bodyStructure: true,
          source: true,
        },
        { uid: useUid },
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

      let body = ''
      if (msg.source) {
        const raw = msg.source.toString('utf8')
        // Extract text body from raw email — basic extraction
        body = this.extractTextFromRaw(raw)
      }

      const uid = msg.uid ?? msg.seq ?? String(Date.now())

      return {
        id: `imap-${uid}`,
        threadId: env?.messageId ?? '',
        from: fromEmail,
        fromName,
        subject: env?.subject ?? '(no subject)',
        body: body.slice(0, 4000),
        receivedAt: env?.date ? new Date(env.date) : new Date(),
        snippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
        labelIds: [],
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
        await client.messageFlagsAdd({ uid: `${uidNum}` }, ['\\Seen'], { uid: true })
      }
      await client.logout()
    } catch (err: any) {
      this.logger.warn(`markAsRead failed: ${this.extractErrorMessage(err)}`)
    } finally {
      try { client.close() } catch {}
    }
  }

  async saveDraft(to: string, subject: string, htmlBody: string, threadId?: string): Promise<boolean> {
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
      const rawMessage = [
        `From: ${this.config.user}`,
        `To: ${to}`,
        `Subject: Re: ${subject.startsWith('Re:') ? subject.slice(4).trim() : subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        `X-Draft: true`,
        ...(threadId ? [`In-Reply-To: ${threadId}`, `References: ${threadId}`] : []),
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
