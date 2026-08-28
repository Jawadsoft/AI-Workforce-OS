import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { BrainService } from '../brain/brain.service'
import { ChatService } from '../chat/chat.service'
import { CrmContextService } from '../crm/crm-context.service'
import { TwilioService } from './twilio.service'

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name)
  /** In-process Twilio webhook dedupe (MessageSid → expiry ms). */
  private readonly recentWebhookSids = new Map<string, number>()

  constructor(
    private prisma: PrismaService,
    private ai: AIService,
    private brain: BrainService,
    private chat: ChatService,
    private crmContext: CrmContextService,
    private twilio: TwilioService,
  ) {}

  /** True if this Twilio MessageSid was already handled (retry / double delivery). */
  private async isDuplicateWebhook(tenantId: string, twilioSid: string): Promise<boolean> {
    if (!twilioSid) return false
    const now = Date.now()
    for (const [sid, exp] of this.recentWebhookSids) {
      if (exp < now) this.recentWebhookSids.delete(sid)
    }
    if (this.recentWebhookSids.has(twilioSid)) return true

    const existing = await this.prisma.communicationLog.findFirst({
      where: { tenantId, twilioSid },
      select: { id: true },
    })
    return Boolean(existing)
  }

  private markWebhookHandled(twilioSid: string) {
    if (!twilioSid) return
    this.recentWebhookSids.set(twilioSid, Date.now() + 10 * 60 * 1000)
  }

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
    mediaContentTypes?: string[]
  }): Promise<{ reply: string; sentViaApi: boolean }> {
    return this.handleInboundMessage({ ...params, channel: 'WHATSAPP' })
  }

  /** Drop whatsapp: prefix; keep digits/+ for CRM / conversation keys. */
  private normalizePhone(raw: string): string {
    if (!raw) return ''
    return raw.replace(/^whatsapp:/i, '').trim()
  }

  private isAudioContentType(contentType: string): boolean {
    const ct = (contentType || '').toLowerCase()
    return ct.startsWith('audio/') || ct.includes('ogg') || ct.includes('opus') || ct.includes('mpeg') || ct.includes('mp4')
  }

  private extensionForContentType(contentType: string): string {
    const ct = (contentType || '').toLowerCase()
    if (ct.includes('ogg') || ct.includes('opus')) return 'ogg'
    if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3'
    if (ct.includes('wav')) return 'wav'
    if (ct.includes('mp4') || ct.includes('m4a')) return 'm4a'
    if (ct.includes('webm')) return 'webm'
    return 'ogg'
  }

  /**
   * Resolve inbound text: prefer Body; if empty and media is audio (WhatsApp voice note),
   * download from Twilio and transcribe with Whisper.
   */
  private async resolveInboundBody(params: {
    tenantId: string
    body: string
    mediaUrls?: string[]
    mediaContentTypes?: string[]
  }): Promise<{ text: string; voiceNoteFailed?: boolean }> {
    const text = (params.body || '').trim()
    const urls = params.mediaUrls || []
    const types = params.mediaContentTypes || []

    if (text) return { text }
    if (!urls.length) return { text: '[empty message]' }

    const audioIdx = urls.findIndex((_, i) => this.isAudioContentType(types[i] || ''))
    // WhatsApp voice notes always include MediaContentType audio/*; don't Whisper unknown images.
    if (audioIdx < 0) {
      const ct = (types[0] || '').toLowerCase()
      if (ct.startsWith('image/')) return { text: '[User sent an image]' }
      if (ct.startsWith('video/')) return { text: '[User sent a video]' }
      if (ct) return { text: '[User sent an attachment]' }
      // No content-type from Twilio — attempt first media as audio (common for voice notes)
    }

    const tryIdx = audioIdx >= 0 ? audioIdx : 0
    const url = urls[tryIdx]
    const contentTypeHint = types[tryIdx] || ''

    try {
      const { buffer, contentType } = await this.twilio.downloadMedia(params.tenantId, url)
      const effectiveType = contentTypeHint || contentType
      if (!this.isAudioContentType(effectiveType) && audioIdx < 0) {
        if (effectiveType.startsWith('image/')) return { text: '[User sent an image]' }
        if (effectiveType.startsWith('video/')) return { text: '[User sent a video]' }
        return { text: '[User sent an attachment]' }
      }

      const ext = this.extensionForContentType(effectiveType)
      const transcript = await this.ai.transcribe(buffer, `whatsapp-voice.${ext}`)
      if (transcript) {
        this.logger.log(`WhatsApp voice note transcribed (${transcript.length} chars)`)
        // Plain user text so the agent answers the content — not "I can't hear audio"
        return { text: transcript }
      }
      return { text: '', voiceNoteFailed: true }
    } catch (err) {
      this.logger.warn(`WhatsApp media transcription failed: ${err}`)
      return { text: '', voiceNoteFailed: true }
    }
  }

  /**
   * Checks if an inbound message comes from a staff member's phone who received
   * an escalation. If so, routes their reply back into the agent conversation
   * and returns a TwiML-ready response so the normal customer-agent flow is skipped.
   */
  private async detectAndRouteStaffReply(
    tenantId: string,
    fromPhone: string,
    body: string,
    channel: string,
    twilioSid: string,
  ): Promise<{ reply: string; sentViaApi: boolean } | null> {
    if (!fromPhone || !body.trim()) return null

    // Match the phone to a staff user in this tenant
    const staffUser = await this.prisma.user.findFirst({
      where: {
        tenantId,
        isActive: true,
        phone: { contains: fromPhone.replace(/\D/g, '').slice(-9) },
      },
      select: { id: true, name: true, designation: true },
    })
    if (!staffUser) return null

    // Find the most recent open escalation ticket that targeted this staff member
    const ticket = await this.prisma.activityTicket.findFirst({
      where: {
        tenantId,
        status: 'OPEN',
        metadata: { path: ['targetUserId'], equals: staffUser.id },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, assignedAgentId: true, metadata: true },
    })
    if (!ticket || !ticket.assignedAgentId) return null

    const meta = (ticket.metadata ?? {}) as Record<string, any>
    const conversationId = meta.conversationId as string | undefined
    if (!conversationId) return null

    // Log the inbound reply
    await this.twilio.logInbound({
      tenantId,
      channel: channel as 'SMS' | 'WHATSAPP',
      from: fromPhone,
      to: '',
      body,
      twilioSid,
      agentId: ticket.assignedAgentId,
      conversationId,
    })
    this.markWebhookHandled(twilioSid)

    // Post staff member's reply into the agent's conversation as a user message
    try {
      const staffLabel = `[Staff reply from ${staffUser.name}${staffUser.designation ? ` — ${staffUser.designation}` : ''}]: ${body}`
      await this.chat.sendMessage(tenantId, conversationId, staffLabel)
      this.logger.log(`[StaffReply] ${staffUser.name} → conversation ${conversationId.slice(-6)}`)
    } catch (err) {
      this.logger.warn(`[StaffReply] Failed to route reply: ${err}`)
    }

    // Close the escalation ticket
    await this.prisma.activityTicket.update({
      where: { id: ticket.id },
      data: { status: 'COMPLETED' },
    })

    const ackMessage = `✅ Got it, ${staffUser.name}. Your reply has been forwarded to the agent.`
    try {
      await this.twilio.sendWhatsApp({ tenantId, to: fromPhone, body: ackMessage, agentId: ticket.assignedAgentId, conversationId })
      return { reply: ackMessage, sentViaApi: true }
    } catch {
      return { reply: ackMessage, sentViaApi: false }
    }
  }

  private async handleInboundMessage(params: {
    tenantId: string
    from: string
    to: string
    body: string
    channel: 'SMS' | 'WHATSAPP'
    twilioSid: string
    mediaUrls?: string[]
    mediaContentTypes?: string[]
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
    const channel = params.channel
    const twilioSid = params.twilioSid

    if (await this.isDuplicateWebhook(tenantId, twilioSid)) {
      this.logger.warn(`Duplicate ${channel} webhook ignored sid=${twilioSid}`)
      return { reply: '', sentViaApi: true }
    }

    // ── Staff escalation reply detection ────────────────────────────
    // If the sender's phone matches a staff member, route their reply back
    // to the agent conversation that contacted them, not as a new customer message.
    const staffReply = await this.detectAndRouteStaffReply(tenantId, from, params.body || '', channel, twilioSid)
    if (staffReply) return staffReply

    let body: string
    let voiceNoteFailed = false
    if (params.channel === 'WHATSAPP') {
      const resolved = await this.resolveInboundBody({
        tenantId,
        body: params.body,
        mediaUrls: params.mediaUrls,
        mediaContentTypes: params.mediaContentTypes,
      })
      body = resolved.text
      voiceNoteFailed = Boolean(resolved.voiceNoteFailed)
    } else {
      body = (params.body || '').trim() || '[empty message]'
    }

    const agent = await this.pickChannelAgent(tenantId, channel)

    await this.twilio.logInbound({
      tenantId,
      channel,
      from,
      to,
      body: voiceNoteFailed ? '[voice note — transcription failed]' : body,
      twilioSid,
      agentId: agent?.id,
    })
    this.markWebhookHandled(twilioSid)

    if (!agent) {
      this.logger.warn(`No ACTIVE agent for tenant=${tenantId} channel=${channel}`)
      return {
        reply: 'Thank you for your message. An agent will be in touch shortly.',
        sentViaApi: false,
      }
    }

    // Don't send failed voice notes into the LLM — that causes "I can't hear audio" loops.
    if (voiceNoteFailed) {
      const reply =
        "Sorry, I couldn't catch that voice note clearly. Could you type your message? Happy to help with a quote or booking."
      const conversation = await this.getOrCreatePhoneConversation(
        tenantId,
        from,
        channel,
        agent.id,
        agent.role,
      )
      try {
        await this.sendReply(tenantId, channel, from, reply, agent.id, conversation.id)
        return { reply, sentViaApi: true }
      } catch (err) {
        this.logger.warn(`Twilio REST send failed after voice-note fallback: ${err}`)
        return { reply, sentViaApi: false }
      }
    }

    // Identify sender (CRM facts) + isolate thread per phone, then run full agent turn
    const conversation = await this.getOrCreatePhoneConversation(tenantId, from, channel, agent.id, agent.role)

    let aiReply =
      'Thank you for your message. We have received it and will follow up shortly.'
    try {
      const result = await this.chat.sendMessage(tenantId, conversation.id, body)
      aiReply = result?.aiMessage?.content?.trim() || aiReply
      this.logger.log(
        `Agentic ${channel} reply via ${agent.name} for ${from} (conv=${conversation.id.slice(-6)})`,
      )
    } catch (err) {
      this.logger.warn(`Agentic ${channel} turn failed: ${err}`)
    }

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

  // ───────────────────── ─────────────────────────
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
    const sid = (s.twilioAccountSid || '').trim()
    const token = (s.twilioAuthToken || '').trim()
    const sidOk = /^AC[0-9a-f]{32}$/i.test(sid)
    const tokenOk = Boolean(token) && !token.includes('*')
    return {
      twilioAccountSid: sidOk ? '***configured***' : '',
      twilioAuthToken: tokenOk ? '***configured***' : '',
      twilioPhoneNumber: s.twilioPhoneNumber || '',
      twilioWhatsAppNumber: s.twilioWhatsAppNumber || '',
      notificationPhone: s.notificationPhone || '',
      notificationWhatsApp: s.notificationWhatsApp || '',
      smsAgentId: s.smsAgentId || '',
      whatsappAgentId: s.whatsappAgentId || '',
      voiceAgentId: s.voiceAgentId || '',
      /** True only when Account SID (ACxxxx) + Auth Token are both present — required for REST + media. */
      twilioCredentialsReady: sidOk && tokenOk,
    }
  }

  async saveSettings(tenantId: string, dto: Record<string, string | undefined>) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
    const existing = (tenant?.settings as Record<string, string>) || {}

    const next = { ...existing }
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue
      const v = typeof value === 'string' ? value.trim() : value
      // Never persist masked placeholders from the GET settings response
      if (typeof v === 'string' && (v.includes('***') || v.toLowerCase() === 'configured')) continue
      // Don't wipe secrets with empty string on partial saves
      if (
        (key === 'twilioAccountSid' || key === 'twilioAuthToken') &&
        (!v || (typeof v === 'string' && !v.length))
      ) {
        continue
      }
      if (key === 'twilioAccountSid' && typeof v === 'string' && v && !/^AC[0-9a-f]{32}$/i.test(v)) {
        throw new BadRequestException(
          'Twilio Account SID must start with AC (32 hex chars). Do not use API Key SID (SK…) or Auth Token here.',
        )
      }
      next[key] = v as string
    }

    await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings: next } })
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

  private async getOrCreatePhoneConversation(
    tenantId: string,
    phone: string,
    channel: 'SMS' | 'WHATSAPP',
    agentId: string,
    agentRole?: string,
  ) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, agentId, callerPhone: phone, channel, createdAt: { gte: cutoff }, status: { not: 'ENDED' } },
      orderBy: { createdAt: 'desc' },
    })

    let senderRole: string = 'unknown'
    let displayName = phone
    let crmId: string | undefined
    let callerEmail: string | undefined
    try {
      const crmCtx = await this.crmContext.fetchContext(tenantId, {
        phone,
        agentRole,
        agentId,
      })
      const sender = this.crmContext.classifySender(crmCtx, agentRole)
      senderRole = sender.role
      displayName = sender.displayName !== 'Unknown sender' ? sender.displayName : phone
      crmId = sender.crmId
      callerEmail = sender.email
    } catch (_) {}

    const title = `${channel} · ${displayName} · ${senderRole}`
    const metadata = {
      callerPhone: phone,
      senderRole,
      displayName,
      ...(crmId ? { crmId } : {}),
      ...(callerEmail ? { callerEmail } : {}),
    }

    if (existing) {
      await this.prisma.conversation.update({
        where: { id: existing.id },
        data: {
          title,
          callerEmail: callerEmail || existing.callerEmail,
          metadata: { ...(existing.metadata as object || {}), ...metadata },
        },
      })
      return this.prisma.conversation.findUniqueOrThrow({ where: { id: existing.id } })
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        agentId,
        callerPhone: phone,
        callerEmail,
        channel,
        status: 'ACTIVE',
        title,
        metadata,
      },
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
