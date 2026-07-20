import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { BrainService } from '../brain/brain.service'
import { CrmContextService } from '../crm/crm-context.service'
import { TwilioService } from './twilio.service'

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name)

  constructor(
    private prisma: PrismaService,
    private ai: AIService,
    private brain: BrainService,
    private crmContext: CrmContextService,
    private twilio: TwilioService,
  ) {}

  // ──────────────────────────────────────────────
  // INBOUND: SMS / WhatsApp → AI agent reply
  // ──────────────────────────────────────────────

  /** Result for Twilio webhooks: prefer REST send + empty TwiML to avoid double replies. */
  async handleInboundSms(params: {
    tenantId: string
    from: string
    to: string
    body: string
    twilioSid: string
  }): Promise<{ reply: string; sentViaApi: boolean }> {
    return this.handleInboundMessage({ ...params, channel: 'SMS' })
  }

  async handleInboundWhatsApp(params: {
    tenantId: string
    from: string
    to: string
    body: string
    twilioSid: string
    mediaUrls?: string[]
  }): Promise<{ reply: string; sentViaApi: boolean }> {
    return this.handleInboundMessage({ ...params, channel: 'WHATSAPP' })
  }

  /** Drop whatsapp: prefix; keep digits/+ for CRM / conversation keys. */
  private normalizePhone(raw: string): string {
    if (!raw) return ''
    return raw.replace(/^whatsapp:/i, '').trim()
  }

  private async handleInboundMessage(params: {
    tenantId: string
    from: string
    to: string
    body: string
    channel: 'SMS' | 'WHATSAPP'
    twilioSid: string
    mediaUrls?: string[]
  }): Promise<{ reply: string; sentViaApi: boolean }> {
    const tenantId = (params.tenantId || '').trim()
    if (!tenantId) {
      this.logger.warn('Inbound message missing tenantId query param')
      return {
        reply: 'Thank you for your message. We will get back to you shortly.',
        sentViaApi: false,
      }
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, settings: true },
    })
    if (!tenant) {
      this.logger.warn(`Inbound message for unknown tenantId=${tenantId}`)
      return {
        reply: 'Thank you for your message. We will get back to you shortly.',
        sentViaApi: false,
      }
    }

    const from = this.normalizePhone(params.from)
    const to = this.normalizePhone(params.to)
    const body = (params.body || '').trim() || '[empty message]'
    const channel = params.channel
    const twilioSid = params.twilioSid

    const agent = await this.pickChannelAgent(tenantId, channel)

    await this.twilio.logInbound({
      tenantId,
      channel,
      from,
      to,
      body,
      twilioSid,
      agentId: agent?.id,
    })

    if (!agent) {
      this.logger.warn(`No ACTIVE agent for tenant=${tenantId} channel=${channel}`)
      return {
        reply: 'Thank you for your message. An agent will be in touch shortly.',
        sentViaApi: false,
      }
    }

    const conversation = await this.getOrCreatePhoneConversation(tenantId, from, channel, agent.id)

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: body,
      },
    })

    const mergedSettings = { ...(tenant.settings as Record<string, unknown> || {}) }
    const brainCtx = this.brain.buildAgentContext(mergedSettings)

    let crmBlock = ''
    try {
      const crmCtx = await this.crmContext.fetchContext(tenantId, { phone: from })
      if (crmCtx) crmBlock = '\n\n' + this.crmContext.formatForPrompt(crmCtx)
    } catch (_) {}

    const agentPrompt = agent.prompt || ''
    const channelHint = channel === 'SMS'
      ? 'You are communicating via SMS. Keep replies concise (under 160 characters).'
      : 'You are communicating via WhatsApp. Keep replies short and helpful (2–4 sentences).'
    const systemPrompt = `${agentPrompt}\n\n${brainCtx}${crmBlock}\n\n${channelHint}`

    const history = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })
    const historyForAI = history.map((m) => ({
      role: (m.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }))

    let aiReply =
      'Thank you for your message. We have received it and will follow up shortly.'
    try {
      aiReply = await this.ai.chat(systemPrompt, historyForAI)
    } catch (err) {
      this.logger.warn(`AI chat failed for inbound ${channel}: ${err}`)
    }

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: aiReply,
        agentId: agent.id,
      },
    })

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    })

    // Prefer REST send so we log OUTBOUND; return empty TwiML to Twilio to avoid a second reply.
    try {
      await this.sendReply(tenantId, channel, from, aiReply, agent.id, conversation.id)
      return { reply: aiReply, sentViaApi: true }
    } catch (err) {
      this.logger.warn(`Twilio REST send failed after inbound — falling back to TwiML Message: ${err}`)
      return { reply: aiReply, sentViaApi: false }
    }
  }

  // ──────────────────────────────────────────────
  // INBOUND: Voice call → TwiML
  // ──────────────────────────────────────────────

  async handleInboundVoice(params: {
    tenantId: string
    from: string
    to: string
    callSid: string
    speechResult?: string
  }): Promise<string> {
    const { tenantId, from, callSid, speechResult } = params

    await this.twilio.logInbound({
      tenantId,
      channel: 'VOICE',
      from,
      to: params.to,
      body: speechResult,
      twilioSid: callSid,
    })

    const agent = await this.pickChannelAgent(tenantId, 'VOICE')
    let greeting = 'Thank you for calling. How can I help you today?'

    if (agent) {
      const tenantData = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
      const brainCtx = this.brain.buildAgentContext(tenantData?.settings as Record<string, unknown> || {})
      const agentPrompt = agent.prompt || ''
      const systemPrompt = `${agentPrompt}\n\n${brainCtx}\n\nYou are on a phone call. Keep responses short and conversational (2-3 sentences max).`

      const userText = speechResult || 'Greet the caller warmly with your name and ask how you can help.'
      try {
        greeting = await this.ai.chat(systemPrompt, [{ role: 'user', content: userText }])
      } catch (err) {
        this.logger.warn(`AI chat failed for voice: ${err}`)
      }
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${this.escapeTwiml(greeting)}</Say>
  <Gather input="speech" action="/api/v1/communications/voice/gather?tenantId=${tenantId}" timeout="5" speechTimeout="auto">
    <Say voice="Polly.Joanna">Is there anything else I can help you with?</Say>
  </Gather>
  <Say voice="Polly.Joanna">Thank you for calling. Goodbye!</Say>
</Response>`

    return twiml
  }

  // ──────────────────────────────────────────────
  // OUTBOUND NOTIFICATIONS
  // ──────────────────────────────────────────────

  async notifyApprovalRequired(params: {
    tenantId: string
    approvalId: string
    agentName: string
    action: string
    channels?: ('SMS' | 'WHATSAPP')[]
  }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { settings: true },
    })

    const settings = (tenant?.settings as Record<string, string>) || {}
    const notifyPhone = settings.notificationPhone
    const notifyWhatsApp = settings.notificationWhatsApp
    const channels = params.channels || ['SMS']

    const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const message = `[AI Workforce] Approval needed: ${params.agentName} wants to "${params.action}". View: ${appUrl}/approvals/${params.approvalId}`

    for (const ch of channels) {
      try {
        if (ch === 'SMS' && notifyPhone) {
          await this.twilio.sendSms({ tenantId: params.tenantId, to: notifyPhone, body: message })
        }
        if (ch === 'WHATSAPP' && notifyWhatsApp) {
          await this.twilio.sendWhatsApp({ tenantId: params.tenantId, to: notifyWhatsApp, body: message })
        }
      } catch (err) {
        this.logger.warn(`Failed to send ${ch} approval notification: ${err}`)
      }
    }
  }

  async sendCustomNotification(params: {
    tenantId: string
    to: string
    message: string
    channel: 'SMS' | 'WHATSAPP'
    agentId?: string
    mediaUrls?: string[]
  }) {
    try {
      if (params.channel === 'SMS') {
        await this.twilio.sendSms({ tenantId: params.tenantId, to: params.to, body: params.message, agentId: params.agentId })
      } else {
        await this.twilio.sendWhatsApp({ tenantId: params.tenantId, to: params.to, body: params.message, mediaUrl: params.mediaUrls, agentId: params.agentId })
      }
      return { success: true }
    } catch (err) {
      const twilioMsg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to send message'
      this.logger.warn(`sendCustomNotification failed: ${twilioMsg}`)
      throw new BadRequestException(twilioMsg)
    }
  }

  // ──────────────────────────────────────────────
  // LOGS
  // ──────────────────────────────────────────────

  async getLogs(tenantId: string, params: { channel?: string; limit?: number; skip?: number }) {
    const where: Record<string, unknown> = { tenantId }
    if (params.channel) where.channel = params.channel

    const [total, logs] = await Promise.all([
      this.prisma.communicationLog.count({ where }),
      this.prisma.communicationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit || 50,
        skip: params.skip || 0,
      }),
    ])
    return { total, logs }
  }

  async getSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
    const s = (tenant?.settings as Record<string, string>) || {}
    return {
      twilioAccountSid: s.twilioAccountSid ? '***configured***' : '',
      twilioAuthToken: s.twilioAuthToken ? '***configured***' : '',
      twilioPhoneNumber: s.twilioPhoneNumber || '',
      twilioWhatsAppNumber: s.twilioWhatsAppNumber || '',
      notificationPhone: s.notificationPhone || '',
      notificationWhatsApp: s.notificationWhatsApp || '',
      smsAgentId: s.smsAgentId || '',
      whatsappAgentId: s.whatsappAgentId || '',
      voiceAgentId: s.voiceAgentId || '',
    }
  }

  async saveSettings(tenantId: string, dto: Record<string, string | undefined>) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
    const existing = (tenant?.settings as Record<string, string>) || {}
    const merged = { ...existing, ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) }
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings: merged } })
    return { success: true }
  }

  async testConnection(tenantId: string) {
    try {
      return await this.twilio.verifyConnection(tenantId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Twilio connection failed'
      this.logger.warn(`Twilio testConnection failed: ${message}`)
      throw new BadRequestException(message)
    }
  }

  // ──────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────

  private async pickChannelAgent(tenantId: string, channel: 'SMS' | 'WHATSAPP' | 'VOICE') {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
    const settings = (tenant?.settings as Record<string, string>) || {}
    const keyMap: Record<string, string> = {
      SMS: 'smsAgentId',
      WHATSAPP: 'whatsappAgentId',
      VOICE: 'voiceAgentId',
    }
    const agentId = settings[keyMap[channel]]
    if (agentId) return this.prisma.agent.findUnique({ where: { id: agentId } })
    return this.prisma.agent.findFirst({ where: { tenantId, status: 'ACTIVE' } })
  }

  private async getOrCreatePhoneConversation(tenantId: string, phone: string, channel: 'SMS' | 'WHATSAPP', agentId: string) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, agentId, callerPhone: phone, channel, createdAt: { gte: cutoff }, status: { not: 'ENDED' } },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return existing
    return this.prisma.conversation.create({
      data: { tenantId, agentId, callerPhone: phone, channel, status: 'ACTIVE', title: `${channel} from ${phone}` },
    })
  }

  private async sendReply(tenantId: string, channel: 'SMS' | 'WHATSAPP', to: string, body: string, agentId?: string, conversationId?: string) {
    if (channel === 'SMS') {
      await this.twilio.sendSms({ tenantId, to, body, agentId, conversationId })
    } else {
      await this.twilio.sendWhatsApp({ tenantId, to, body, agentId, conversationId })
    }
  }

  private escapeTwiml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}
