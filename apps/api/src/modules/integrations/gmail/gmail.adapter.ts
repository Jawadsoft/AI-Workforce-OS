import { Logger } from '@nestjs/common'
import { google, gmail_v1 } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'

export interface RawEmail {
  id: string
  threadId: string
  from: string
  fromName: string
  subject: string
  body: string
  receivedAt: Date
  snippet: string
  labelIds: string[]
  /** Value of the In-Reply-To header from the incoming email (for threading replies) */
  inReplyTo?: string
  /** Full References chain from the incoming email (space-separated Message-IDs) */
  references?: string[]
}

export class GmailAdapter {
  private readonly logger = new Logger(GmailAdapter.name)
  private gmail: gmail_v1.Gmail

  constructor(private readonly auth: OAuth2Client) {
    // Cast to any: pnpm deduplication can leave two google-auth-library versions
    // which cause private-property type mismatches at compile time only.
    this.gmail = google.gmail({ version: 'v1', auth: auth as any })
  }

  async listUnread(maxResults = 20): Promise<RawEmail[]> {
    try {
      // Prefer unread; if none, fall back to recent inbox (14 days).
      // Users often open mail on phone/web before clicking Scan Now.
      let res = await this.gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread in:inbox -category:promotions -category:social',
        maxResults,
      })

      let messages = res.data.messages ?? []
      if (!messages.length) {
        res = await this.gmail.users.messages.list({
          userId: 'me',
          q: 'in:inbox newer_than:14d -category:promotions -category:social',
          maxResults,
        })
        messages = res.data.messages ?? []
      }

      if (!messages.length) return []

      const emails = await Promise.all(
        messages.map(m => this.getMessage(m.id!))
      )
      return emails.filter(Boolean) as RawEmail[]
    } catch (err: any) {
      this.logger.error(`listUnread failed: ${err.message}`)
      throw new Error(`Gmail fetch failed: ${err.message}`)
    }
  }

  private async getMessage(id: string): Promise<RawEmail | null> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      })
      const msg = res.data
      const headers = msg.payload?.headers ?? []

      const getHeader = (name: string) =>
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

      const fromRaw = getHeader('From')
      const fromMatch = fromRaw.match(/^"?([^"<]*)"?\s*<?([^>]*)>?$/)
      const fromName = fromMatch?.[1]?.trim() || fromRaw
      const from = fromMatch?.[2]?.trim() || fromRaw

      const body = this.extractBody(msg.payload)

      const inReplyToRaw = getHeader('In-Reply-To')
      const referencesRaw = getHeader('References')

      return {
        id,
        threadId: msg.threadId ?? '',
        from,
        fromName,
        subject: getHeader('Subject'),
        body: body.slice(0, 4000),
        receivedAt: new Date(parseInt(msg.internalDate ?? '0')),
        snippet: msg.snippet ?? '',
        labelIds: msg.labelIds ?? [],
        inReplyTo: inReplyToRaw || undefined,
        references: referencesRaw ? referencesRaw.split(/\s+/).filter(Boolean) : undefined,
      }
    } catch {
      return null
    }
  }

  private extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return ''

    // Plain text first
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf8')
    }

    // HTML fallback - strip tags
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      const html = Buffer.from(payload.body.data, 'base64').toString('utf8')
      return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    }

    // Multipart - recurse
    if (payload.parts) {
      for (const part of payload.parts) {
        const text = this.extractBody(part)
        if (text) return text
      }
    }

    return ''
  }

  async archiveEmail(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['INBOX', 'UNREAD'] },
    })
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    })
  }

  async sendReply(to: string, subject: string, body: string, threadId?: string): Promise<string> {
    const raw = this.buildRawEmail(to, subject, body)
    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        ...(threadId ? { threadId } : {}),
      },
    })
    // Return the Gmail message ID so callers can track it in allMessageIds
    return res.data.id ?? ''
  }

  async createDraft(to: string, subject: string, body: string, threadId?: string): Promise<string> {
    const raw = this.buildRawEmail(to, subject, body)
    const res = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw,
          ...(threadId ? { threadId } : {}),
        },
      },
    })
    return res.data.id ?? ''
  }

  private buildRawEmail(to: string, subject: string, body: string): string {
    const lines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body,
    ]
    return Buffer.from(lines.join('\r\n')).toString('base64url')
  }
}
