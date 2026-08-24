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

  async sendReply(params: {
    to: string
    subject: string
    html: string
    text?: string
    inReplyTo?: string
    /** Full prior References chain from the incoming email. The inReplyTo value
     *  is automatically appended so callers only need to pass the original chain. */
    references?: string[]
  }): Promise<void> {
    // Guard against malformed addresses
    if (!params.to || params.to.includes('undefined') || !params.to.includes('@')) {
      this.logger.warn(`sendReply skipped — invalid recipient: "${params.to}"`)
      return
    }
    // Build complete References chain: prior chain + immediate parent (deduplicated)
    const refChain = [...(params.references ?? []), ...(params.inReplyTo ? [params.inReplyTo] : [])]
      .filter((v, i, a) => v && a.indexOf(v) === i)
    const transporter = this.buildTransporter()
    await transporter.sendMail({
      from: `"${this.config.smtpFromName}" <${this.config.fromEmail}>`,
      to: params.to,
      subject: params.subject.startsWith('Re:') ? params.subject : `Re: ${params.subject}`,
      html: params.html,
      text: params.text,
      ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
      ...(refChain.length ? { references: refChain.join(' ') } : {}),
    })
    this.logger.log(`Reply sent from ${this.config.fromEmail} to ${params.to}`)
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
