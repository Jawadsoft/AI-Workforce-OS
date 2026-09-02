import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import Twilio from 'twilio'

export interface SendSmsDto {
  tenantId: string
  to: string
  body: string
  agentId?: string
  conversationId?: string
}

export interface SendWhatsAppDto {
  tenantId: string
  to: string
  body: string
  mediaUrl?: string[]
  agentId?: string
  conversationId?: string
  /** Twilio Content Template SID (e.g. HXxxx). When set, sends a template message instead of free-form. */
  contentSid?: string
  /** Template variable values keyed by position: { "1": "value1", "2": "value2" } */
  contentVariables?: Record<string, string>
}

export interface MakeCallDto {
  tenantId: string
  to: string
  twiml: string
}

type TwilioCreds = {
  accountSid: string
  authToken: string
  fromPhone: string
  whatsappNumber: string
}

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name)

  constructor(private prisma: PrismaService) {}

  /** True Account SID (ACxxxx). Rejects API keys (SK), placeholders, empty. */
  private isValidAccountSid(sid: string | undefined | null): boolean {
    if (!sid || typeof sid !== 'string') return false
    const s = sid.trim()
    if (!s || s.includes('*') || s.toLowerCase().includes('configured')) return false
    return /^AC[0-9a-f]{32}$/i.test(s)
  }

  private isUsableSecret(value: string | undefined | null): boolean {
    if (!value || typeof value !== 'string') return false
    const v = value.trim()
    return Boolean(v) && !v.includes('*') && !v.toLowerCase().includes('configured')
  }

  /** Tenant settings only — never falls back to process.env Twilio vars. */
  private async resolveCreds(tenantId: string): Promise<TwilioCreds> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    })
    const settings = (tenant?.settings as Record<string, string>) || {}

    const tenantSid = (settings.twilioAccountSid || '').trim()
    const tenantToken = (settings.twilioAuthToken || '').trim()

    if (tenantSid && !this.isValidAccountSid(tenantSid)) {
      this.logger.warn(
        `Tenant ${tenantId} has invalid twilioAccountSid (must be ACxxxx, not "${tenantSid.slice(0, 8)}…"). Clearing bad value.`,
      )
      try {
        const scrubbed = { ...settings }
        delete scrubbed.twilioAccountSid
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { settings: scrubbed },
        })
      } catch (err) {
        this.logger.warn(`Failed to scrub invalid twilioAccountSid: ${err}`)
      }
      throw new Error(
        'Invalid Twilio Account SID in tenant Communications settings. It must start with AC (34 chars). Do not use the WhatsApp business name. Re-save Account SID + Auth Token for this tenant.',
      )
    }

    if (!this.isValidAccountSid(tenantSid) || !this.isUsableSecret(tenantToken)) {
      const hasWa = Boolean((settings.twilioWhatsAppNumber || '').trim())
      throw new Error(
        hasWa
          ? 'WhatsApp number is set, but Account SID (ACxxxx) and/or Auth Token are missing for this tenant. Inbound chat can still reply via webhook TwiML, but voice notes and REST sends need SID + Auth Token in Communications settings (re-save both, then Test connection).'
          : 'Twilio is not configured for this tenant. Set Account SID (ACxxxx) and Auth Token in Communications settings — env TWILIO_* vars are not used.',
      )
    }

    return {
      accountSid: tenantSid,
      authToken: tenantToken,
      fromPhone: (settings.twilioPhoneNumber || '').trim(),
      whatsappNumber: (settings.twilioWhatsAppNumber || '').trim(),
    }
  }

  private async getClient(tenantId: string) {
    const creds = await this.resolveCreds(tenantId)
    return {
      client: Twilio(creds.accountSid, creds.authToken),
      fromPhone: creds.fromPhone,
      whatsappNumber: creds.whatsappNumber,
      accountSid: creds.accountSid,
      authToken: creds.authToken,
    }
  }

  /** Live check against Twilio API (Account SID + Auth Token). */
  async verifyConnection(tenantId: string): Promise<{ status: string; friendlyName: string; accountSid: string }> {
    const { client, accountSid } = await this.getClient(tenantId)
    const account = await client.api.accounts(accountSid).fetch()
    return {
      status: account.status || 'active',
      friendlyName: account.friendlyName || 'Twilio Account',
      accountSid,
    }
  }

  async sendSms(dto: SendSmsDto): Promise<void> {
    const { client, fromPhone } = await this.getClient(dto.tenantId)
    const msg = await client.messages.create({
      from: fromPhone,
      to: dto.to,
      body: dto.body,
    })
    await this.prisma.communicationLog.create({
      data: {
        tenantId: dto.tenantId,
        channel: 'SMS',
        direction: 'OUTBOUND',
        from: fromPhone,
        to: dto.to,
        body: dto.body,
        status: msg.status,
        twilioSid: msg.sid,
        agentId: dto.agentId,
        conversationId: dto.conversationId,
      },
    })
    this.logger.log(`SMS sent to ${dto.to} (${msg.sid})`)
  }

  async sendWhatsApp(dto: SendWhatsAppDto): Promise<void> {
    const { client, whatsappNumber } = await this.getClient(dto.tenantId)
    if (!whatsappNumber) {
      throw new Error('WhatsApp sender number not configured (twilioWhatsAppNumber)')
    }
    const from = whatsappNumber.startsWith('whatsapp:')
      ? whatsappNumber
      : `whatsapp:${whatsappNumber}`
    const to = dto.to.startsWith('whatsapp:') ? dto.to : `whatsapp:${dto.to}`

    const msg = await client.messages.create({
      from,
      to,
      // Use approved template when contentSid is provided (bypasses 24h session window)
      ...(dto.contentSid
        ? {
            contentSid: dto.contentSid,
            contentVariables: dto.contentVariables ? JSON.stringify(dto.contentVariables) : undefined,
          }
        : { body: dto.body }),
      ...(dto.mediaUrl?.length ? { mediaUrl: dto.mediaUrl } : {}),
    })
    await this.prisma.communicationLog.create({
      data: {
        tenantId: dto.tenantId,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        from,
        to,
        body: dto.body,
        status: msg.status,
        twilioSid: msg.sid,
        agentId: dto.agentId,
        conversationId: dto.conversationId,
      },
    })
    this.logger.log(`WhatsApp sent to ${dto.to} (${msg.sid})`)
  }

  async makeCall(dto: MakeCallDto): Promise<void> {
    const { client, fromPhone } = await this.getClient(dto.tenantId)
    const call = await client.calls.create({
      from: fromPhone,
      to: dto.to,
      twiml: dto.twiml,
    })
    await this.prisma.communicationLog.create({
      data: {
        tenantId: dto.tenantId,
        channel: 'VOICE',
        direction: 'OUTBOUND',
        from: fromPhone,
        to: dto.to,
        status: call.status,
        twilioSid: call.sid,
      },
    })
    this.logger.log(`Call initiated to ${dto.to} (${call.sid})`)
  }

  async logInbound(params: {
    tenantId: string
    channel: 'SMS' | 'WHATSAPP' | 'VOICE'
    from: string
    to: string
    body?: string
    twilioSid?: string
    agentId?: string
    conversationId?: string
    durationSec?: number
  }) {
    return this.prisma.communicationLog.create({
      data: {
        ...params,
        direction: 'INBOUND',
        status: 'received',
      },
    })
  }

  private extractAccountSidFromMediaUrl(mediaUrl: string): string | null {
    const m = mediaUrl.match(/\/Accounts\/(AC[0-9a-f]{32})\//i)
    return m?.[1] ?? null
  }

  /** Download Twilio-hosted media (WhatsApp voice notes, images, etc.). Requires Basic auth. */
  async downloadMedia(
    tenantId: string,
    mediaUrl: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const creds = await this.resolveCreds(tenantId)
    const urlSid = this.extractAccountSidFromMediaUrl(mediaUrl)
    if (urlSid && urlSid.toLowerCase() !== creds.accountSid.toLowerCase()) {
      throw new Error(
        `WhatsApp media belongs to Twilio account ${urlSid}, but credentials are for ${creds.accountSid}. ` +
          `Open Communications settings and set Account SID + Auth Token from the SAME Twilio console account that owns your WhatsApp sender (Account SID starts with AC — not the business name "Xtreme…").`,
      )
    }

    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')
    // Twilio media URLs redirect to a signed CDN; auth only on the first hop.
    const first = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${auth}` },
      redirect: 'manual',
    })
    let res = first
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get('location')
      if (!location) throw new Error(`Twilio media redirect missing Location (${first.status})`)
      res = await fetch(location, { redirect: 'follow' })
    }
    if (!res.ok) {
      throw new Error(
        `Twilio media download failed: HTTP ${res.status}. Re-copy Account SID (ACxxxx) + Auth Token from Twilio Console for account ${creds.accountSid.slice(0, 8)}…`,
      )
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const arrayBuf = await res.arrayBuffer()
    return { buffer: Buffer.from(arrayBuf), contentType }
  }
}
