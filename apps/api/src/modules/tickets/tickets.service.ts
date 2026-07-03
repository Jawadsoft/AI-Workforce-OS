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

function derivePendingReason(ticket: any): string {
  if (!ticket) return 'No active stage'
  const meta = (ticket.metadata as any) ?? {}
  switch (ticket.status as string) {
    case 'OPEN':
      return ticket.followUpAt
        ? `Scheduled for follow-up on ${new Date(ticket.followUpAt).toLocaleDateString('en-GB')}`
        : 'Waiting for agent to pick up'
    case 'IN_PROGRESS':
      return `Agent ${ticket.assignedAgent?.name ?? 'assigned'} is working on this`
    case 'AWAITING_CUSTOMER':
      return ticket.followUpAt
        ? `Awaiting customer reply — follow-up scheduled for ${new Date(ticket.followUpAt).toLocaleDateString('en-GB')}${meta.followUpAttempts ? ` (attempt ${meta.followUpAttempts}/3)` : ''}`
        : 'Awaiting customer response'
    case 'AWAITING_AGENT':
      return `Waiting for ${ticket.assignedAgent?.name ?? 'agent'} to review`
    case 'SCHEDULED':
      return ticket.followUpAt
        ? `Inspection scheduled for ${new Date(ticket.followUpAt).toLocaleDateString('en-GB')}`
        : 'Appointment confirmed — date TBD'
    case 'ESCALATED':
      return 'Escalated — requires manual intervention'
    case 'COMPLETED':
      return 'Stage complete'
    case 'CANCELLED':
      return 'Cancelled'
    default:
      return ticket.nextAction ?? 'Pending'
  }
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

  // ── Lead Journey ───────────────────────────────────────────────────

  async getLeadJourney(tenantId: string, leadId: string) {
    const tickets = await this.prisma.activityTicket.findMany({
      where: { tenantId, leadId },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        assignedAgent: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
    })

    if (!tickets.length) {
      // Fallback: look up by metadata.crmLeadId (backfill path for tickets created before leadId column existed)
      const all = await this.prisma.activityTicket.findMany({
        where: {
          tenantId,
          metadata: { path: ['crmLeadId'], equals: leadId },
        },
        include: {
          createdBy: { select: { id: true, name: true, role: true } },
          assignedAgent: { select: { id: true, name: true, role: true } },
        },
        orderBy: [{ createdAt: 'asc' }],
      })

      if (all.length) {
        // Backfill leadId for next time
        await this.prisma.activityTicket.updateMany({
          where: {
            tenantId,
            metadata: { path: ['crmLeadId'], equals: leadId },
            leadId: null,
          },
          data: { leadId },
        })
      }

      return this.buildJourneyResponse(leadId, all)
    }

    return this.buildJourneyResponse(leadId, tickets)
  }

  private buildJourneyResponse(leadId: string, tickets: any[]) {
    const stageOrder: Record<string, number> = {
      OPEN: 0, IN_PROGRESS: 1, AWAITING_CUSTOMER: 2, AWAITING_AGENT: 2,
      SCHEDULED: 3, ESCALATED: 1, COMPLETED: 4, CANCELLED: 4,
    }

    // Sort by pipelineStageIndex then createdAt
    const sorted = [...tickets].sort((a, b) => {
      const ai = (a.metadata as any)?.pipelineStageIndex ?? 999
      const bi = (b.metadata as any)?.pipelineStageIndex ?? 999
      if (ai !== bi) return ai - bi
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

    // Merged timeline from all activity logs
    const mergedTimeline: any[] = sorted.flatMap((t) => {
      const log = (t.activityLog as any[]) ?? []
      return log.map(entry => ({ ...entry, ticketId: t.id, ticketTitle: t.title, stageIndex: (t.metadata as any)?.pipelineStageIndex }))
    }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    const currentTicket = sorted.find(t => !['COMPLETED', 'CANCELLED'].includes(t.status))
    const lastTicket = sorted[sorted.length - 1]

    const pendingReason = currentTicket
      ? derivePendingReason(currentTicket)
      : null

    return {
      leadId,
      contactRef: lastTicket?.contactRef ?? null,
      contactEmail: lastTicket?.contactEmail ?? null,
      contactPhone: lastTicket?.contactPhone ?? null,
      currentStage: (currentTicket?.metadata as any)?.pipelineStageIndex ?? null,
      currentStatus: currentTicket?.status ?? lastTicket?.status ?? null,
      pendingReason,
      stages: sorted.map(t => ({
        id: t.id,
        shortId: t.id.slice(-6),
        ticketNumber: t.ticketNumber,
        stageIndex: (t.metadata as any)?.pipelineStageIndex ?? null,
        stageName: (t.metadata as any)?.pipelineStageName ?? t.title,
        status: t.status,
        assignedAgent: t.assignedAgent ? { id: t.assignedAgent.id, name: t.assignedAgent.name, role: t.assignedAgent.role } : null,
        nextAction: t.nextAction,
        followUpAt: t.followUpAt,
        followUpAttempts: (t.metadata as any)?.followUpAttempts ?? 0,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        resolvedAt: t.resolvedAt,
      })),
      timeline: mergedTimeline,
      totalStages: sorted.length,
      completedStages: sorted.filter(t => t.status === 'COMPLETED').length,
    }
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
