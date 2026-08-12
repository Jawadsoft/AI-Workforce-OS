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
  private isValidAccountSid(sid: string | undefined | null): sid is string {
    if (!sid || typeof sid !== 'string') return false
    const s = sid.trim()
    if (!s || s.includes('*') || s.toLowerCase().includes('configured')) return false
    return /^AC[0-9a-f]{32}$/i.test(s)
  }

  private isUsableSecret(value: string | undefined | null): value is string {
    if (!value || typeof value !== 'string') return false
    const v = value.trim()
    return Boolean(v) && !v.includes('*') && !v.toLowerCase().includes('configured')
  }

  private async resolveCreds(tenantId: string): Promise<TwilioCreds> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    })
    const settings = (tenant?.settings as Record<string, string>) || {}

    const tenantSid = settings.twilioAccountSid?.trim()
    const tenantToken = settings.twilioAuthToken?.trim()
    const envSid = process.env.TWILIO_ACCOUNT_SID?.trim()
    const envToken = process.env.TWILIO_AUTH_TOKEN?.trim()

    let accountSid: string | undefined
    let authToken: string | undefined

    if (this.isValidAccountSid(tenantSid) && this.isUsableSecret(tenantToken)) {
      accountSid = tenantSid.trim()
      authToken = tenantToken.trim()
    } else if (tenantSid && !this.isValidAccountSid(tenantSid)) {
      this.logger.warn(
        `Tenant ${tenantId} has invalid twilioAccountSid (must be ACxxxx, got "${tenantSid.slice(0, 4)}…"). Falling back to env.`,
      )
    }

    if (!accountSid || !authToken) {
      if (this.isValidAccountSid(envSid) && this.isUsableSecret(envToken)) {
        accountSid = envSid.trim()
        authToken = envToken.trim()
      }
    }

    if (!accountSid || !authToken) {
      throw new Error(
        'Twilio credentials not configured. Set Account SID (starts with AC) and Auth Token in Communications settings or TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.',
      )
    }

    return {
      accountSid,
      authToken,
      fromPhone: settings.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER || '',
      whatsappNumber: settings.twilioWhatsAppNumber || process.env.TWILIO_WHATSAPP_NUMBER || '',
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
      body: dto.body,
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
      this.logger.warn(
        `Media URL account ${urlSid.slice(0, 6)}… differs from configured ${creds.accountSid.slice(0, 6)}… — using configured creds`,
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
        `Twilio media download failed: HTTP ${res.status} (check Account SID ACxxxx + Auth Token match the Twilio account that received the WhatsApp message)`,
      )
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const arrayBuf = await res.arrayBuffer()
    return { buffer: Buffer.from(arrayBuf), contentType }
  }
}
