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
}

export class AccountMailer {
  private readonly logger = new Logger(AccountMailer.name)

  constructor(private readonly config: AccountMailerConfig) {}

  private buildTransporter() {
    const password = decrypt(this.config.encryptedSmtpPassword)
    return nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      auth: { user: this.config.smtpUser, pass: password },
      tls: { rejectUnauthorized: false },
    })
  }

  async sendReply(params: {
    to: string
    subject: string
    html: string
    text?: string
    inReplyTo?: string
  }): Promise<void> {
    // Guard against malformed addresses
    if (!params.to || params.to.includes('undefined') || !params.to.includes('@')) {
      this.logger.warn(`sendReply skipped — invalid recipient: "${params.to}"`)
      return
    }
    const transporter = this.buildTransporter()
    await transporter.sendMail({
      from: `"${this.config.smtpFromName}" <${this.config.fromEmail}>`,
      to: params.to,
      subject: params.subject.startsWith('Re:') ? params.subject : `Re: ${params.subject}`,
      html: params.html,
      text: params.text,
      ...(params.inReplyTo ? { inReplyTo: params.inReplyTo, references: params.inReplyTo } : {}),
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

  static fromAccountMetadata(meta: any, accountEmail: string): AccountMailer {
    return new AccountMailer({
      smtpHost: meta.smtpHost,
      smtpPort: meta.smtpPort ?? 587,
      smtpSecure: meta.smtpSecure ?? false,
      smtpUser: meta.smtpUser || accountEmail,
      encryptedSmtpPassword: meta.encryptedSmtpPassword,
      smtpFromName: meta.smtpFromName || accountEmail,
      fromEmail: accountEmail,
    })
  }
}
