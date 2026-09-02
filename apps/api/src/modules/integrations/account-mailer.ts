import * as nodemailer from 'nodemailer'
import { Logger } from '@nestjs/common'
import { decrypt } from './crypto.util'

export interface AccountMailerConfig {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  encryptedSmtpPassword: string
  smtpFromName: string
  fromEmail: string
  /** OAuth2 access token — when provided, XOAUTH2 is used instead of password (Microsoft/O365) */
  accessToken?: string
}

export class AccountMailer {
  private readonly logger = new Logger(AccountMailer.name)

  constructor(private readonly config: AccountMailerConfig) {}

  private buildTransporter() {
    const baseOptions = {
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      tls: { rejectUnauthorized: false },
    }
    // Use XOAUTH2 for Microsoft/O365 when an OAuth2 access token is available
    if (this.config.accessToken) {
      return nodemailer.createTransport({
        ...baseOptions,
        auth: {
          type: 'OAuth2',
          user: this.config.smtpUser,
          accessToken: this.config.accessToken,
        },
      })
    }
    const password = decrypt(this.config.encryptedSmtpPassword)
    return nodemailer.createTransport({
      ...baseOptions,
      auth: { user: this.config.smtpUser, pass: password },
    })
  }

  /**
   * Send a reply email and return the exact Message-ID that was used on the wire.
   * The returned ID must be stored in EmailConversation.allMessageIds so future
   * customer replies (which reference this ID via In-Reply-To) can be threaded.
   */
  async sendReply(params: {
    to: string
    subject: string
    html: string
    text?: string
    inReplyTo?: string
    /** Full conversation References chain (allMessageIds). inReplyTo is appended automatically. */
    references?: string[]
    /** Pre-generated Message-ID to use. When omitted nodemailer assigns one. */
    messageId?: string
    /** CC recipients for Reply All — connected account address is excluded automatically */
    cc?: string[]
  }): Promise<string> {
    // Guard against malformed addresses
    if (!params.to || params.to.includes('undefined') || !params.to.includes('@')) {
      this.logger.warn(`sendReply skipped — invalid recipient: "${params.to}"`)
      return params.messageId ?? ''
    }
    // Build complete References chain: prior chain + immediate parent (deduplicated)
    const refChain = [...(params.references ?? []), ...(params.inReplyTo ? [params.inReplyTo] : [])]
      .filter((v, i, a) => v && a.indexOf(v) === i)
    // Filter out the sending account from CC to avoid self-CC
    const ccList = (params.cc ?? []).filter(addr =>
      addr && addr.includes('@') && addr.toLowerCase() !== this.config.fromEmail.toLowerCase()
    )
    const transporter = this.buildTransporter()
    const info = await transporter.sendMail({
      from: `"${this.config.smtpFromName}" <${this.config.fromEmail}>`,
      to: params.to,
      ...(ccList.length ? { cc: ccList.join(', ') } : {}),
      subject: params.subject.startsWith('Re:') ? params.subject : `Re: ${params.subject}`,
      html: params.html,
      text: params.text,
      ...(params.messageId ? { messageId: params.messageId } : {}),
      ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
      ...(refChain.length ? { references: refChain.join(' ') } : {}),
    })
    // info.messageId is the actual Message-ID accepted by the SMTP server
    const sentId: string = info.messageId ?? params.messageId ?? ''
    this.logger.log(`Reply sent from ${this.config.fromEmail} to ${params.to}${ccList.length ? ` cc ${ccList.join(', ')}` : ''} (Message-ID: ${sentId})`)
    return sentId
  }

  async testSmtp(): Promise<{ success: boolean; error?: string }> {
    try {
      const transporter = this.buildTransporter()
      await transporter.verify()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  static fromAccountMetadata(meta: any, accountEmail: string, accessToken?: string): AccountMailer {
    return new AccountMailer({
      smtpHost: meta.smtpHost,
      smtpPort: meta.smtpPort ?? 587,
      smtpSecure: meta.smtpSecure ?? false,
      smtpUser: meta.smtpUser || accountEmail,
      encryptedSmtpPassword: meta.encryptedSmtpPassword ?? '',
      smtpFromName: meta.smtpFromName || accountEmail,
      fromEmail: accountEmail,
      accessToken,
    })
  }
}
