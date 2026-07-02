import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { EmailService } from '../email/email.service'

export type NotificationChannel = 'email' | 'chat' | 'sms'
export type NotificationUrgency = 'info' | 'warning' | 'urgent'

export interface NotificationPayload {
  tenantId: string
  channel: NotificationChannel
  subject: string
  message: string
  urgency?: NotificationUrgency
  /** Override recipient email (defaults to tenant owner) */
  toEmail?: string
  /** Override recipient phone for SMS (defaults to tenant owner) */
  toPhone?: string
}

/**
 * Centralized Notification Service
 *
 * Provides a single entry point for all agent/system notifications:
 *  - email: sends via tenant SMTP (or fallback .env SMTP)
 *  - sms:   sends via Twilio (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM)
 *  - chat:  posts a system briefing message into the tenant's active conversation
 *
 * Usage:
 *   await this.notificationService.send({
 *     tenantId,
 *     channel: 'email',
 *     subject: 'Daily Briefing',
 *     message: '<p>...</p>',
 *     urgency: 'info',
 *   })
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async send(payload: NotificationPayload): Promise<void> {
    const { channel } = payload
    switch (channel) {
      case 'email': return this.sendEmail(payload)
      case 'sms':   return this.sendSms(payload)
      default:
        this.logger.warn(`[Notification] Unknown channel: ${channel}`)
    }
  }

  // ── Email ─────────────────────────────────────────────────────────

  private async sendEmail(payload: NotificationPayload): Promise<void> {
    try {
      let toEmail = payload.toEmail
      if (!toEmail) {
        const owner = await this.prisma.user.findFirst({
          where: { tenantId: payload.tenantId, role: { in: ['TENANT_OWNER', 'TENANT_ADMIN'] } },
          orderBy: { createdAt: 'asc' },
          select: { email: true },
        })
        toEmail = owner?.email
      }

      if (!toEmail) {
        this.logger.warn(`[Notification] No recipient email for tenant ${payload.tenantId}`)
        return
      }

      const urgencyPrefix =
        payload.urgency === 'urgent'  ? '🚨 URGENT: ' :
        payload.urgency === 'warning' ? '⚠️ '         : ''

      await this.email.send({
        tenantId: payload.tenantId,
        to: toEmail,
        subject: `${urgencyPrefix}${payload.subject}`,
        html: payload.message,
      })

      this.logger.log(`[Notification] Email sent to ${toEmail} — "${payload.subject}"`)
    } catch (err: any) {
      this.logger.error(`[Notification] Email failed: ${err.message}`)
    }
  }

  // ── SMS via Twilio ────────────────────────────────────────────────

  private async sendSms(payload: NotificationPayload): Promise<void> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken  = process.env.TWILIO_AUTH_TOKEN
    const fromNumber = process.env.TWILIO_FROM

    if (!accountSid || !authToken || !fromNumber) {
      this.logger.warn('[Notification] Twilio not configured — SMS skipped')
      return
    }

    let toPhone = payload.toPhone
    if (!toPhone) {
      const owner = await this.prisma.user.findFirst({
        where: { tenantId: payload.tenantId, role: { in: ['TENANT_OWNER', 'TENANT_ADMIN'] } },
        orderBy: { createdAt: 'asc' },
        select: { phone: true } as any,
      })
      toPhone = (owner as any)?.phone
    }

    if (!toPhone) {
      this.logger.warn(`[Notification] No recipient phone for tenant ${payload.tenantId} — SMS skipped`)
      return
    }

    try {
      // Dynamic import avoids hard dependency on twilio package if not installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const twilio = require('twilio')
      const client = twilio(accountSid, authToken)

      // Strip HTML tags for SMS
      const smsBody = payload.message.replace(/<[^>]+>/g, '').slice(0, 1600)

      await client.messages.create({
        body: smsBody,
        from: fromNumber,
        to: toPhone,
      })

      this.logger.log(`[Notification] SMS sent to ${toPhone}`)
    } catch (err: any) {
      this.logger.error(`[Notification] SMS failed: ${err.message}`)
    }
  }

  // ── Daily digest email helper ─────────────────────────────────────

  async sendDailyDigest(tenantId: string, digestHtml: string): Promise<void> {
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    await this.send({
      tenantId,
      channel: 'email',
      subject: `Daily Operations Digest — ${today}`,
      message: digestHtml,
      urgency: 'info',
    })
  }

  // ── Storm alert helper ────────────────────────────────────────────

  async sendStormAlert(tenantId: string, details: { zipCodes: string[]; eventType: string; severity: string; leadCount: number }): Promise<void> {
    const html = `
      <h2>⛈️ Storm Alert — New Leads Created</h2>
      <p><strong>Event:</strong> ${details.eventType}</p>
      <p><strong>Severity:</strong> ${details.severity}</p>
      <p><strong>Affected ZIP codes:</strong> ${details.zipCodes.join(', ')}</p>
      <p><strong>New lead tickets created:</strong> ${details.leadCount}</p>
      <p>Your agents have been briefed and will begin qualifying these leads automatically.</p>
    `
    await this.send({
      tenantId,
      channel: 'email',
      subject: `Storm Alert — ${details.leadCount} new lead(s) in ${details.zipCodes.slice(0,3).join(', ')}`,
      message: html,
      urgency: 'urgent',
    })
  }
}
