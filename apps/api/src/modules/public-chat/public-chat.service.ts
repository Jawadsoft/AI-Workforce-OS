import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { ChatService } from '../chat/chat.service'

// Simple in-memory rate limiter (IP -> { count, resetAt })
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const MAX_MESSAGES_PER_HOUR = 40

@Injectable()
export class PublicChatService {
  private readonly logger = new Logger(PublicChatService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
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

    // Create an anonymous system user for widget conversations
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

  async streamMessage(
    tenantId: string,
    sessionId: string,
    content: string,
    emit: (data: object) => void,
  ) {
    return this.chat.streamMessage(tenantId, sessionId, content, emit)
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
      collectName: widgetSettings.collectName ?? false,
      collectEmail: widgetSettings.collectEmail ?? false,
      collectPhone: widgetSettings.collectPhone ?? false,
    }
  }
}
