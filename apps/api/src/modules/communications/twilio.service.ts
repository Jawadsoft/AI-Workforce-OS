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

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name)

  constructor(private prisma: PrismaService) {}

  private async getClient(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    })
    const settings = (tenant?.settings as Record<string, string>) || {}
    const accountSid = settings.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID
    const authToken = settings.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN

    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured for this tenant')
    }
    return {
      client: Twilio(accountSid, authToken),
      fromPhone: settings.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER || '',
      whatsappNumber: settings.twilioWhatsAppNumber || process.env.TWILIO_WHATSAPP_NUMBER || '',
      accountSid,
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
    const from = `whatsapp:${whatsappNumber}`
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
}
