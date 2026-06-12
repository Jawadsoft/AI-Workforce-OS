import { Injectable, NotFoundException, ForbiddenException, Logger, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { ChatService } from '../chat/chat.service'

// Simple in-memory rate limiter (IP -> { count, resetAt })
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const MAX_MESSAGES_PER_HOUR = 40

// Session idle tracker: sessionId -> timer handle
// After IDLE_MS of silence we post the full conversation summary once
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>()
const sessionNotified = new Set<string>() // tracks sessions that got the "customer started chat" ping
const sessionExchangeCount = new Map<string, number>() // tracks # of customer messages per session
const sessionCustomerName = new Map<string, string>() // sessionId -> detected customer name
const IDLE_MS = 30 * 1000 // 30 seconds of inactivity triggers summary
const LIVE_UPDATE_EVERY = 2 // send a live mid-session update every N customer messages

// Extract a first name from a message like "My name is Mac" or "I am Jorge"
function extractCustomerName(text: string): string | null {
  const m = text.match(/(?:my name is|i(?:'?m| am)|this is)\s+([A-Z][a-z]{1,20})/i)
  return m ? m[1] : null
}

@Injectable()
export class PublicChatService {
  private readonly logger = new Logger(PublicChatService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatService)) private readonly chat: ChatService,
  ) {}

  // ── Rate limit check ──────────────────────────────────────────────

  checkRateLimit(ip: string): void {
    const now = Date.now()
    const entry = rateLimitMap.get(ip)

    if (entry) {
      if (now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 })
        return
      }
      if (entry.count >= MAX_MESSAGES_PER_HOUR) {
        throw new ForbiddenException('Rate limit exceeded. Please try again later.')
      }
      entry.count++
    } else {
      rateLimitMap.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 })
    }
  }

  // ── Validate tenant + agent ───────────────────────────────────────

  async validateAgent(tenantId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, role: true, avatar: true },
    })
    if (!agent) throw new NotFoundException('Agent not found or not active')

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, isActive: true, settings: true },
    })
    if (!tenant || !tenant.isActive) throw new ForbiddenException('This workspace is not available')

    const widgetEnabled = (tenant.settings as any)?.widget?.enabled !== false
    if (!widgetEnabled) throw new ForbiddenException('Widget is disabled for this workspace')

    return { agent, tenant }
  }

  // ── Get or create a widget session ───────────────────────────────

  async getOrCreateSession(tenantId: string, agentId: string, sessionId?: string, visitorInfo?: {
    name?: string
    email?: string
    phone?: string
  }) {
    if (sessionId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: sessionId, tenantId, agentId, channel: 'WIDGET' },
        select: { id: true },
      })
      if (existing) return existing.id
    }

    const systemUser = await this.getOrCreateWidgetUser(tenantId)

    const conv = await this.prisma.conversation.create({
      data: {
        tenantId,
        agentId,
        userId: systemUser.id,
        channel: 'WIDGET' as any,
        title: visitorInfo?.name ? `Chat with ${visitorInfo.name}` : 'Widget Chat',
        status: 'OPEN',
        metadata: {
          source: 'widget',
          visitorName: visitorInfo?.name,
          callerEmail: visitorInfo?.email,
          callerPhone: visitorInfo?.phone,
        } as any,
      },
    })

    return conv.id
  }

  private async getOrCreateWidgetUser(tenantId: string) {
    const email = `widget-bot@tenant-${tenantId}.internal`
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing) return existing

    return this.prisma.user.create({
      data: {
        email,
        name: 'Widget Bot',
        password: '',
        role: 'VIEWER',
        tenantId,
        isActive: true,
      },
    })
  }

  // ── Get messages for a session ────────────────────────────────────

  async getMessages(tenantId: string, sessionId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: sessionId, tenantId, channel: 'WIDGET' },
    })
    if (!conv) throw new NotFoundException('Session not found')
    return this.prisma.message.findMany({
      where: { conversationId: sessionId },
      orderBy: { createdAt: 'asc' },
    })
  }

  // ── Stream a message ──────────────────────────────────────────────
  // After each message we RESET the idle timer.
  // When the timer fires (3 min inactivity) we post ONE full summary briefing.

  async streamMessage(
    tenantId: string,
    sessionId: string,
    content: string,
    emit: (data: object) => void,
  ) {
    // Seed customer name from pre-chat form metadata BEFORE the first ping
    if (!sessionCustomerName.has(sessionId)) {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: sessionId, tenantId },
        select: { metadata: true },
      })
      const meta = conv?.metadata as any
      const formName = meta?.visitorName
      if (formName) {
        sessionCustomerName.set(sessionId, formName)
      } else {
        // Fall back to regex extraction from message text
        const regexName = extractCustomerName(content)
        if (regexName) sessionCustomerName.set(sessionId, regexName)
      }
    }

    await this.chat.streamMessage(tenantId, sessionId, content, emit)

    // On the FIRST message of a session, post an instant "customer is chatting" ping
    if (!sessionNotified.has(sessionId)) {
      sessionNotified.add(sessionId)
      this.postFirstMessagePing(tenantId, sessionId, content).catch(() => {})
    }

    // Increment exchange counter and send a live mid-session update every N exchanges
    const count = (sessionExchangeCount.get(sessionId) ?? 0) + 1
    sessionExchangeCount.set(sessionId, count)
    if (count % LIVE_UPDATE_EVERY === 0) {
      this.postSessionSummary(tenantId, sessionId, true).catch(() => {})
    }

    // Reset idle timer — cancel any existing one and start fresh
    this.scheduleSessionSummary(tenantId, sessionId)
  }

  // ── Inject a message from the operator into the widget session ────
  // Called when Rachel uses the reply_to_widget_session tool

  async replyToWidgetSession(tenantId: string, sessionId: string, agentMessage: string): Promise<void> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: sessionId, tenantId, channel: 'WIDGET' },
    })
    if (!conv) throw new NotFoundException('Widget session not found')

    await this.prisma.message.create({
      data: {
        conversationId: sessionId,
        role: 'ASSISTANT',
        content: agentMessage,
        briefingType: null,
      },
    })

    await this.prisma.conversation.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    })

    this.logger.log(`Operator reply injected into widget session ${sessionId}`)
  }

  // ── First-message ping (instant, lightweight) ─────────────────────

  private async postFirstMessagePing(tenantId: string, sessionId: string, firstMessage: string) {
    try {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: sessionId, tenantId },
        include: { agent: { select: { id: true } } },
      })
      if (!conv) return

      const meta = conv.metadata as any
      const detectedName = sessionCustomerName.get(sessionId)
      const visitorId = detectedName || meta?.visitorName || meta?.callerPhone || meta?.callerEmail || 'a website visitor'

      const ping = [
        `💬 **New Website Chat** — **${visitorId}** just started chatting`,
        `🔑 **Session ID: \`${sessionId}\`** ← use this to reply`,
        '',
        `*"${firstMessage.slice(0, 160)}${firstMessage.length > 160 ? '...' : ''}"*`,
        '',
        `_Live updates will follow as the conversation continues._`,
        '',
        `⚡ To reply to **${visitorId}**, tell me: **"reply to session ${sessionId}: your message here"**`,
      ].join('\n')

      await this.chat.postBriefing(tenantId, conv.agentId, ping, 'widget')
    } catch (err: any) {
      this.logger.warn(`Failed to post first-message ping: ${err.message}`)
    }
  }

  // ── Schedule an end-of-session summary briefing ───────────────────
  // Resets on every message — only fires after IDLE_MS silence

  private scheduleSessionSummary(tenantId: string, sessionId: string) {
    // Clear any existing timer for this session
    const existing = sessionTimers.get(sessionId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      sessionTimers.delete(sessionId)
      sessionNotified.delete(sessionId)
      sessionExchangeCount.delete(sessionId)
      // Keep name cached a bit longer so agent can still reference it
      setTimeout(() => sessionCustomerName.delete(sessionId), 60 * 60 * 1000) // 1 hour
      await this.postSessionSummary(tenantId, sessionId, false)
    }, IDLE_MS)

    sessionTimers.set(sessionId, timer)
  }

  // ── Build and post a session summary briefing ────────────────────
  // isLiveUpdate=true  → mid-conversation update every LIVE_UPDATE_EVERY exchanges
  // isLiveUpdate=false → final idle-triggered summary

  private async postSessionSummary(tenantId: string, sessionId: string, isLiveUpdate = false) {
    try {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: sessionId, tenantId },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          agent: { select: { id: true, name: true } },
        },
      })
      if (!conv || !conv.messages.length) return

      const meta = conv.metadata as any

      // Prefer in-memory detected name, then metadata, then scan messages
      const allText = conv.messages.map(m => m.content).join(' ')
      const scannedName = extractCustomerName(allText)
      const detectedName = sessionCustomerName.get(sessionId)
      const visitorName = detectedName || scannedName || meta?.visitorName || meta?.callerPhone || meta?.callerEmail || 'a website visitor'

      // Cache it if we just found it
      if ((detectedName || scannedName) && !sessionCustomerName.has(sessionId)) {
        sessionCustomerName.set(sessionId, (detectedName || scannedName)!)
      }

      const visitorContact = [meta?.callerPhone, meta?.callerEmail].filter(Boolean).join(' · ')

      // Build a readable transcript (trim long messages)
      const transcript = conv.messages
        .filter(m => !m.briefingType) // skip internal briefing messages
        .map(m => {
          const who = m.role === 'USER' ? `👤 ${visitorName}` : `🤖 ${conv.agent.name}`
          const text = (m.content ?? '').slice(0, 200)
          return `${who}: ${text}${(m.content?.length ?? 0) > 200 ? '...' : ''}`
        }).join('\n')

      const phoneMatch = allText.match(/(?:\+?\d[\d\s\-().]{7,}\d)/)
      const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)

      const contactLine = visitorContact
        ? `**Contact:** ${visitorContact}`
        : phoneMatch ? `**Detected phone:** ${phoneMatch[0]}`
        : emailMatch ? `**Detected email:** ${emailMatch[0]}`
        : ''

      const title = isLiveUpdate
        ? `💬 **Website Chat Update** — **${visitorName}** _(conversation still active)_`
        : `💬 **Website Chat Summary** — **${visitorName}** _(conversation ended)_`

      const summary = [
        title,
        `🔑 **Session ID: \`${sessionId}\`** ← to reply to **${visitorName}**, say: "reply to session ${sessionId}: your message"`,
        contactLine,
        `**Messages:** ${conv.messages.filter(m => !m.briefingType).length} (${Math.ceil(conv.messages.filter(m => !m.briefingType).length / 2)} exchanges)`,
        '',
        '**Conversation:**',
        transcript,
        '',
        `---`,
        `⚡ **${visitorName}'s session ID is \`${sessionId}\`**`,
      ].filter(l => l !== undefined && l !== null).join('\n')

      await this.chat.postBriefing(tenantId, conv.agentId, summary, 'widget')
      this.logger.log(`Session ${isLiveUpdate ? 'update' : 'summary'} posted for ${sessionId}`)
    } catch (err: any) {
      this.logger.warn(`Failed to post session summary: ${err.message}`)
    }
  }

  // ── List active widget sessions (for the agent to reference) ────────
  // Returns sessions that have a pending idle timer (customer still active or recently active)

  getActiveSessions(tenantId: string) {
    const active: Array<{ sessionId: string; customerName: string }> = []
    for (const [sid, name] of sessionCustomerName.entries()) {
      active.push({ sessionId: sid, customerName: name })
    }
    return active
  }

  // ── Get widget config (public, safe data only) ────────────────────

  async getWidgetConfig(tenantId: string, agentId: string) {
    const { agent, tenant } = await this.validateAgent(tenantId, agentId)
    const settings = (tenant.settings as any) ?? {}
    const widgetSettings = settings.widget ?? {}

    return {
      agentName: agent.name,
      agentRole: agent.role,
      agentAvatar: agent.avatar ?? null,
      companyName: settings.brain?.companyName || tenant.name,
      welcomeMessage: widgetSettings.welcomeMessage || `Hi! I'm ${agent.name}. How can I help you today?`,
      primaryColor: widgetSettings.primaryColor || '#6366f1',
      placeholder: widgetSettings.placeholder || 'Type a message...',
      collectName: widgetSettings.collectName ?? true,   // always collect name by default
      collectEmail: widgetSettings.collectEmail ?? false,
      collectPhone: widgetSettings.collectPhone ?? false,
    }
  }
}
