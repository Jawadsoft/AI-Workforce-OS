import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'

export interface TicketActivityEntry {
  agentName: string
  agentId: string
  action: string
  note: string
  timestamp: string
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ── List tickets ───────────────────────────────────────────────────

  findAll(tenantId: string, filters?: {
    status?: string
    source?: string
    assignedAgentId?: string
    contactRef?: string
    type?: string
    limit?: number
  }) {
    const where: any = { tenantId }
    if (filters?.status) where.status = filters.status
    if (filters?.source) where.source = filters.source
    if (filters?.assignedAgentId) where.assignedAgentId = filters.assignedAgentId
    if (filters?.contactRef) where.contactRef = { contains: filters.contactRef, mode: 'insensitive' }
    if (filters?.type) where.type = filters.type

    return this.prisma.activityTicket.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        assignedAgent: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: filters?.limit ?? 100,
    })
  }

  // ── Find open ticket for a conversation (gives LLM context for its decision) ──

  async findOpenForConversation(tenantId: string, conversationId: string) {
    // Only surface tickets that still need action (OPEN or IN_PROGRESS).
    // COMPLETED tickets are done — don't anchor the LLM to a resolved past request.
    return this.prisma.activityTicket.findFirst({
      where: {
        tenantId,
        conversationId,
        status: { notIn: ['COMPLETED', 'CANCELLED', 'SCHEDULED'] },
      },
      include: {
        assignedAgent: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  // ── Get tickets assigned to a specific agent ───────────────────────

  async getForAgent(tenantId: string, agentId: string) {
    const tickets = await this.prisma.activityTicket.findMany({
      where: {
        tenantId,
        assignedAgentId: agentId,
        // Only return OPEN and IN_PROGRESS tickets — COMPLETED ones are done.
        status: { notIn: ['COMPLETED', 'CANCELLED', 'SCHEDULED'] },
      },
      select: {
        id: true, ticketNumber: true, title: true, description: true,
        notes: true, status: true, priority: true, contactRef: true,
        contactPhone: true, contactEmail: true, nextAction: true,
        followUpAt: true, createdAt: true, updatedAt: true,
        assignedAgentId: true, createdByAgentId: true,
      },
      orderBy: [{ priority: 'desc' }, { followUpAt: 'asc' }, { createdAt: 'desc' }],
      take: 20,
    })
    return tickets
  }

  // ── Format pending tickets for system prompt injection ─────────────

  async buildPromptBlock(tenantId: string, agentId: string, conversationId?: string): Promise<string> {
    const [tickets, convTicket] = await Promise.all([
      this.getForAgent(tenantId, agentId),
      conversationId ? this.findOpenForConversation(tenantId, conversationId) : Promise.resolve(null),
    ])

    // Only surface the conversation ticket if this agent still owns it.
    // If it has been delegated to a specialist (assignedAgentId !== agentId),
    // the intake agent must NOT see it — it would anchor them to a past customer
    // instead of responding to the owner's current message.
    const ownedConvTicket = convTicket?.assignedAgentId === agentId ? convTicket : null

    // CONVERSATION TICKET — only shown when this agent owns the ticket for the active conversation.
    // Kept minimal: just enough context so the agent knows the reference ID and can update it.
    // No "must action" language — the agent should focus on the live conversation, not the ticket.
    let convBlock = ''
    if (ownedConvTicket) {
      convBlock = [
        `\n\n[BACKGROUND — current conversation ticket]`,
        `#${ownedConvTicket.id.slice(-6)} "${ownedConvTicket.title}" (${ownedConvTicket.status})`,
        ownedConvTicket.description ? `Context: ${ownedConvTicket.description}` : '',
        (ownedConvTicket as any).notes ? `Notes: ${(ownedConvTicket as any).notes}` : '',
        `If the owner's message is about the same customer/job → update_ticket "${ownedConvTicket.id.slice(-6)}"`,
        `If it's a different customer or new job → create_ticket`,
      ].filter(Boolean).join('\n')
    }

    if (!tickets.length) return convBlock

    // PENDING QUEUE — background awareness only. Agents focus on the live conversation;
    // the cron scheduler drives autonomous ticket processing separately.
    // ESCALATED is system-set (no-response flag) and gets a nudge; everything else is silent.
    const escalated = tickets.filter(t => t.status === 'ESCALATED')
    const routine   = tickets.filter(t => t.status !== 'ESCALATED')

    const formatLine = (t: any) => {
      const contact = t.contactRef ? ` · ${t.contactRef}` : ''
      const due = t.followUpAt ? ` · due ${new Date(t.followUpAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''
      const status = t.status === 'OPEN' ? 'open' : t.status === 'IN_PROGRESS' ? 'in progress' : t.status.toLowerCase()
      return `  #${t.id.slice(-6)} ${t.title} [${status}]${contact}${due}`
    }

    const sections: string[] = []
    if (escalated.length) {
      sections.push(`⚠️ Flagged by system (${escalated.length}) — action when you can:`)
      sections.push(...escalated.map(formatLine))
    }
    if (routine.length) {
      sections.push(`${routine.length} background ticket${routine.length > 1 ? 's' : ''} (cron is handling these):`)
      sections.push(...routine.map(formatLine))
    }

    return `${convBlock}\n\n[TICKET AWARENESS]\n${sections.join('\n')}`
  }

  // ── Get single ticket ──────────────────────────────────────────────

  async findOne(tenantId: string, id: string) {
    const ticket = await this.prisma.activityTicket.findFirst({
      where: { id, tenantId },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        assignedAgent: { select: { id: true, name: true, role: true } },
      },
    })
    if (!ticket) throw new NotFoundException('Ticket not found')
    return ticket
  }

  // ── Get ticket with full conversation thread ───────────────────────

  async getWithThread(tenantId: string, id: string) {
    const ticket = await this.prisma.activityTicket.findFirst({
      where: { id, tenantId },
      include: {
        createdBy: { select: { id: true, name: true, role: true, avatar: true } },
        assignedAgent: { select: { id: true, name: true, role: true, avatar: true } },
      },
    })
    if (!ticket) throw new NotFoundException('Ticket not found')

    let thread: { role: string; content: string; agentName?: string; createdAt: string }[] = []

    if (ticket.conversationId) {
      const messages = await this.prisma.message.findMany({
        where: { conversationId: ticket.conversationId },
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true, createdAt: true, agentId: true },
      })

      // Get agent name for the conversation
      const conv = await this.prisma.conversation.findUnique({
        where: { id: ticket.conversationId },
        include: { agent: { select: { id: true, name: true, role: true } } },
      })

      thread = messages.map(m => ({
        role: m.role,
        content: m.content,
        agentName: m.role === 'ASSISTANT' ? (conv?.agent?.name ?? 'Agent') : 'Staff',
        createdAt: m.createdAt.toISOString(),
      }))
    }

    return { ...ticket, thread }
  }

  // ── Create ticket ──────────────────────────────────────────────────

  async create(tenantId: string, agentId: string, agentName: string, data: {
    title: string
    subject?: string
    description?: string
    type?: string
    priority?: string
    source?: string
    conversationId?: string
    contactRef?: string
    contactPhone?: string
    contactEmail?: string
    assignedAgentId?: string
    nextAction?: string
    followUpAt?: string
    metadata?: any
  }) {
    const initialLog: TicketActivityEntry = {
      agentName,
      agentId,
      action: 'TICKET_CREATED',
      note: data.description ?? data.title,
      timestamp: new Date().toISOString(),
    }

    // Resolve assigned agent — if not specified, assign to creating agent
    const assignedAgentId = data.assignedAgentId ?? agentId

    return this.prisma.activityTicket.create({
      data: {
        tenantId,
        source: data.source ?? 'INTERNAL',
        conversationId: data.conversationId ?? null,
        title: data.title,
        subject: data.subject,
        description: data.description,
        type: data.type ?? 'GENERAL',
        priority: (data.priority ?? 'MEDIUM') as any,
        status: 'OPEN',
        contactRef: data.contactRef,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail,
        createdByAgentId: agentId,
        assignedAgentId,
        nextAction: data.nextAction,
        followUpAt: data.followUpAt ? new Date(data.followUpAt) : null,
        activityLog: [initialLog] as any,
        metadata: data.metadata ?? {},
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        assignedAgent: { select: { id: true, name: true, role: true } },
      },
    })
  }

  // ── Update ticket ──────────────────────────────────────────────────

  async update(tenantId: string, ticketId: string, agentId: string, agentName: string, data: {
    status?: string
    priority?: string
    nextAction?: string
    note?: string
    assignedAgentId?: string
    followUpAt?: string
    resolvedAt?: string
  }) {
    const ticket = await this.prisma.activityTicket.findFirst({ where: { id: ticketId, tenantId } })
    if (!ticket) throw new NotFoundException('Ticket not found')

    const logEntry: TicketActivityEntry = {
      agentName,
      agentId,
      action: data.status ? `STATUS_CHANGED_TO_${data.status}` : 'UPDATED',
      note: data.note ?? `Updated by ${agentName}`,
      timestamp: new Date().toISOString(),
    }

    const existingLog = (ticket.activityLog as unknown as TicketActivityEntry[]) ?? []

    return this.prisma.activityTicket.update({
      where: { id: ticketId },
      data: {
        ...(data.status ? { status: data.status as any } : {}),
        ...(data.priority ? { priority: data.priority as any } : {}),
        ...(data.nextAction !== undefined ? { nextAction: data.nextAction } : {}),
        ...(data.assignedAgentId !== undefined ? { assignedAgentId: data.assignedAgentId } : {}),
        ...(data.followUpAt ? { followUpAt: new Date(data.followUpAt) } : {}),
        ...(data.status === 'COMPLETED' || data.status === 'CANCELLED' ? { resolvedAt: new Date() } : {}),
        activityLog: [...existingLog, logEntry] as any,
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        assignedAgent: { select: { id: true, name: true, role: true } },
      },
    })
  }

  // ── Delete ticket ──────────────────────────────────────────────────

  async remove(tenantId: string, id: string) {
    await this.prisma.activityTicket.deleteMany({ where: { id, tenantId } })
    return { success: true }
  }

  // ── Scheduled: check overdue follow-ups every 15 minutes ──────────

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkFollowUps() {
    const overdue = await this.prisma.activityTicket.findMany({
      where: {
        followUpAt: { lte: new Date() },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        assignedAgent: { select: { id: true, name: true, tenantId: true } },
      },
      take: 50,
    })

    for (const ticket of overdue) {
      this.logger.log(`[Tickets] Follow-up due: #${ticket.id.slice(-6)} — "${ticket.title}" assigned to ${ticket.assignedAgent?.name ?? 'unassigned'}`)

      // Log the overdue event in the ticket's activity log
      const existingLog = (ticket.activityLog as unknown as TicketActivityEntry[]) ?? []
      const alreadyFlagged = existingLog.some(e => e.action === 'FOLLOW_UP_OVERDUE')

      if (!alreadyFlagged) {
        await this.prisma.activityTicket.update({
          where: { id: ticket.id },
          data: {
            activityLog: [
              ...existingLog,
              {
                agentName: 'System',
                agentId: 'system',
                action: 'FOLLOW_UP_OVERDUE',
                note: `Follow-up was due at ${ticket.followUpAt?.toISOString()}. Next action: ${ticket.nextAction ?? 'Review and update ticket'}`,
                timestamp: new Date().toISOString(),
              },
            ] as any,
          },
        })
      }
    }

    if (overdue.length > 0) {
      this.logger.log(`[Tickets] ${overdue.length} overdue follow-up(s) flagged`)
    }
  }
}
