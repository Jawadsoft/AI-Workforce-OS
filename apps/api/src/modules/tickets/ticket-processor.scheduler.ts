import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'
import { ChatService } from '../chat/chat.service'

/**
 * Autonomous ticket processor — runs every minute.
 *
 * Finds assigned tickets that need agent action and wakes the assigned agent
 * so they can action and update the ticket autonomously.
 *
 * Two-tier idle gate:
 *  - OPEN tickets (never woken): no idle gate — wake on first cron run
 *  - IN_PROGRESS / AWAITING_AGENT / ESCALATED tickets: 2-min cooldown (updatedAt)
 *
 * Safety guards:
 *  - Only processes tickets created within the last 48 hours (avoids old test data)
 *  - Processes max 10 tickets per run (1 per agent) to prevent LLM flood
 *  - Wraps each ticket in try/catch so one failure doesn't block others
 *  - Agents woken here run in isSpecialist mode — cannot create duplicate tickets
 *
 * Also runs a no-response escalation check every 2 minutes:
 *  - Finds tickets still OPEN (never acknowledged) 15+ minutes after creation
 *  - Marks them ESCALATED, logs the event, and wakes the assigned agent with an
 *    urgent escalation briefing so they cannot miss it
 *  - Only fires once per ticket (idempotent — checks activityLog for NO_RESPONSE flag)
 */
@Injectable()
export class TicketProcessorScheduler {
  private readonly logger = new Logger(TicketProcessorScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  @Cron('* * * * *')
  async processOpenTickets() {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)

    // Two-tier fetch:
    // Tier 1 — OPEN tickets: never been woken (autoWakeAgent stamps IN_PROGRESS on first wake),
    //          so no idle gate needed — pick them up immediately on the first cron run.
    // Tier 2 — IN_PROGRESS / ESCALATED: apply 2-min cooldown via updatedAt
    //          so we don't re-wake the same agent on every consecutive minute.
    const [freshTickets, idleTickets] = await Promise.all([
      this.prisma.activityTicket.findMany({
        where: {
          status: 'OPEN',
          assignedAgentId: { not: null },
          tenant: { isActive: true },
          createdAt: { gte: fortyEightHoursAgo },
        },
        include: {
          assignedAgent: { select: { id: true, name: true, role: true, tenantId: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ priority: 'desc' }, { followUpAt: 'asc' }, { createdAt: 'asc' }],
        take: 10,
      }),
      this.prisma.activityTicket.findMany({
        where: {
          status: { in: ['IN_PROGRESS', 'ESCALATED'] },
          assignedAgentId: { not: null },
          tenant: { isActive: true },
          createdAt: { gte: fortyEightHoursAgo },
          updatedAt: { lt: twoMinutesAgo },   // 2-min cooldown for already-woken tickets
        },
        include: {
          assignedAgent: { select: { id: true, name: true, role: true, tenantId: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ priority: 'desc' }, { followUpAt: 'asc' }, { createdAt: 'asc' }],
        take: 10,
      }),
    ])

    // Merge: fresh (OPEN) tickets first, then idle in-progress ones
    // De-duplicate by ticket ID in case both queries somehow return the same row
    const seen = new Set<string>()
    const tickets = [...freshTickets, ...idleTickets].filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    }).slice(0, 10)  // hard cap at 10 per run

    if (!tickets.length) return

    this.logger.log(`[TicketProcessor] Processing ${tickets.length} pending ticket(s)`)

    // De-duplicate: process max ONE ticket per agent per cron run
    // This prevents a single agent from being woken 5 times simultaneously
    const seenAgentIds = new Set<string>()

    for (const ticket of tickets) {
      if (!ticket.assignedAgent) continue
      if (seenAgentIds.has(ticket.assignedAgent.id)) {
        this.logger.log(`[TicketProcessor] Skipping ticket ${ticket.id.slice(-6)} — ${ticket.assignedAgent.name} already queued this run`)
        continue
      }
      seenAgentIds.add(ticket.assignedAgent.id)

      try {
        const ticketNum = String(ticket.ticketNumber ?? '').padStart(4, '0')
        const isOverdue = ticket.followUpAt && new Date(ticket.followUpAt) < new Date()

        // Bump updatedAt NOW before waking — this resets the 5-min cooldown window
        // and prevents the next cron run from picking up the same ticket immediately
        await this.prisma.activityTicket.update({
          where: { id: ticket.id },
          data: { updatedAt: new Date() },
        })

        const briefing = [
          `⏰ **Autonomous ticket review — action required**`,
          `Ticket #${ticketNum} (ID: ${ticket.id.slice(-6)}): "${ticket.title}"`,
          `Status: ${ticket.status} | Priority: ${ticket.priority}`,
          ticket.contactRef ? `Contact: ${ticket.contactRef}` : '',
          ticket.contactPhone ? `Phone: ${ticket.contactPhone}` : '',
          ticket.description ? `Context: ${ticket.description}` : '',
          ticket.nextAction ? `Pending action: ${ticket.nextAction}` : '',
          isOverdue ? `⚠️ OVERDUE — follow-up was due ${new Date(ticket.followUpAt!).toLocaleDateString('en-GB')}` : '',
          ``,
          `SELF-TRIAGE RULE (check this FIRST):`,
          `• Read the ticket title and description carefully.`,
          `• Does this ticket belong to YOUR role (${ticket.assignedAgent?.role ?? 'your role'})?`,
          `• ROLE GUIDE: scheduling/booking/dates = operations coordinator | carrying out the inspection on site = field inspector | pricing/quotes = estimator | insurance/claims = insurance specialist`,
          `• If this ticket requires scheduling or booking a date and you are NOT the operations coordinator → reassign immediately to operations role.`,
          `• If NO in general — immediately call update_ticket with ticketId "${ticket.id.slice(-6)}" and set assignedAgentRole to the correct colleague's role. Do not attempt to action work outside your expertise.`,
          `• If YES — proceed with the instructions below.`,
          ``,
          `INSTRUCTIONS (only if ticket is correctly assigned to you):`,
          `1. Review this ticket and decide what action is needed.`,
          `2. Call update_ticket with ticketId "${ticket.id.slice(-6)}" and set the correct status:`,
          `   • Started / still working on it → IN_PROGRESS`,
          `   • Fully resolved (booking confirmed, estimate sent, done) → COMPLETED`,
          `3. If you need input from a colleague, reassign via update_ticket with assignedAgentRole.`,
          `4. DO NOT create a new ticket — update this one (${ticket.id.slice(-6)}) only.`,
          `5. DO NOT contact the customer directly.`,
        ].filter(Boolean).join('\n')

        this.logger.log(`[TicketProcessor] Waking ${ticket.assignedAgent.name} for ticket #${ticketNum}`)

        await this.chat.autoWakeAgent(
          ticket.tenantId,
          ticket.assignedAgent.id,
          ticket.id,
          briefing,
          ticket.createdBy?.id ?? ticket.assignedAgent.id,
          ticket.conversationId ?? undefined,
          ticket.createdBy?.name,
        )

      } catch (err: any) {
        this.logger.warn(`[TicketProcessor] Failed for ticket ${ticket.id.slice(-6)}: ${err.message}`)
      }
    }

    this.logger.log(`[TicketProcessor] Run complete — ${seenAgentIds.size} agent(s) woken`)
  }

  /**
   * No-response escalation — runs every 5 minutes.
   *
   * If a ticket is still OPEN (status never moved from OPEN, meaning the assigned
   * agent has not acknowledged or actioned it at all) and it was created 15+ minutes
   * ago, escalate immediately:
   *   1. Change status → ESCALATED
   *   2. Add NO_RESPONSE activity log entry (idempotent guard — only fires once)
   *   3. Wake the assigned agent with an urgent escalation briefing
   */
  @Cron('*/2 * * * *')
  async checkNoResponseEscalation() {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)

    // Only tickets that are still OPEN (never progressed) AND were created 15+ min ago
    const tickets = await this.prisma.activityTicket.findMany({
      where: {
        status: 'OPEN',
        assignedAgentId: { not: null },
        tenant: { isActive: true },
        createdAt: { gte: fortyEightHoursAgo, lte: fifteenMinutesAgo },
      },
      include: {
        assignedAgent: { select: { id: true, name: true, role: true, tenantId: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 20,
    })

    if (!tickets.length) return

    for (const ticket of tickets) {
      if (!ticket.assignedAgent) continue

      // Idempotent guard — skip if already escalated this way
      const log = (ticket.activityLog as Array<{ action: string }>) ?? []
      if (log.some(e => e.action === 'NO_RESPONSE_ESCALATION')) continue

      try {
        const ticketNum = String(ticket.ticketNumber ?? '').padStart(4, '0')
        const ageMinutes = Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / 60000)

        this.logger.warn(
          `[TicketProcessor] No-response escalation: ticket #${ticketNum} assigned to ${ticket.assignedAgent.name} — open for ${ageMinutes} min with no action`,
        )

        // Mark ESCALATED and append log entry atomically
        await this.prisma.activityTicket.update({
          where: { id: ticket.id },
          data: {
            status: 'ESCALATED',
            updatedAt: new Date(),
            activityLog: [
              ...log,
              {
                agentName: 'System',
                agentId: 'system',
                action: 'NO_RESPONSE_ESCALATION',
                note: `Ticket was open for ${ageMinutes} minutes with no response from ${ticket.assignedAgent.name}. Auto-escalated.`,
                timestamp: new Date().toISOString(),
              },
            ] as any,
          },
        })

        // Wake the assigned agent with an urgent escalation briefing
        const briefing = [
          `🚨 **ESCALATION — No response detected**`,
          `Ticket #${ticketNum} (ID: ${ticket.id.slice(-6)}): "${ticket.title}"`,
          `This ticket was assigned to you ${ageMinutes} minutes ago and has had NO action taken on it.`,
          `Priority: ${ticket.priority}`,
          ticket.contactRef ? `Contact: ${ticket.contactRef}` : '',
          ticket.contactPhone ? `Phone: ${ticket.contactPhone}` : '',
          ticket.description ? `Context: ${ticket.description}` : '',
          ticket.nextAction ? `Expected next action: ${ticket.nextAction}` : '',
          ``,
          `URGENT INSTRUCTIONS:`,
          `1. You MUST acknowledge this ticket immediately — call update_ticket with ticketId "${ticket.id.slice(-6)}" and status IN_PROGRESS.`,
          `2. Carry out the required action (call, email, schedule, quote — whatever the ticket demands).`,
          `3. Update the ticket: IN_PROGRESS while working, COMPLETED when fully resolved.`,
          `4. If you are genuinely unable to action this, reassign via update_ticket with assignedAgentRole.`,
          `5. DO NOT leave this ticket unactioned.`,
        ].filter(Boolean).join('\n')

        await this.chat.autoWakeAgent(
          ticket.tenantId,
          ticket.assignedAgent.id,
          ticket.id,
          briefing,
          ticket.createdBy?.id ?? ticket.assignedAgent.id,
          ticket.conversationId ?? undefined,
          ticket.createdBy?.name,
        )

        // Also alert the Tier 2 coordinator (operations/scheduling) so they can
        // re-assign or follow up if the assigned agent still doesn't respond.
        const tier2Keywords = ['operations', 'coordinator', 'office manager', 'admin manager', 'ops lead', 'scheduling']
        const coordinator = await this.prisma.agent.findFirst({
          where: {
            tenantId: ticket.tenantId,
            status: 'ACTIVE',
            NOT: { id: ticket.assignedAgent.id },
            OR: tier2Keywords.map(k => ({ role: { contains: k, mode: 'insensitive' as const } })),
          },
          orderBy: { createdAt: 'asc' },
        })

        if (coordinator) {
          const coordBriefing = [
            `⚠️ **Escalation alert — no response from ${ticket.assignedAgent.name}**`,
            `Ticket #${String(ticket.ticketNumber ?? '').padStart(4, '0')} (ID: ${ticket.id.slice(-6)}): "${ticket.title}"`,
            `Assigned to: ${ticket.assignedAgent.name} | Open for: ${ageMinutes} minutes with no action`,
            ticket.contactRef ? `Contact: ${ticket.contactRef}` : '',
            ``,
            `As coordinator, you may want to:`,
            `1. Reassign via update_ticket(ticketId: "${ticket.id.slice(-6)}", assignedAgentRole: "[correct role]")`,
            `2. Or contact ${ticket.assignedAgent.name} directly to check their availability`,
          ].filter(Boolean).join('\n')

          this.logger.log(`[TicketProcessor] Alerting coordinator ${coordinator.name} about escalated ticket #${ticket.id.slice(-6)}`)
          setImmediate(() => {
            this.chat.autoWakeAgent(
              ticket.tenantId,
              coordinator.id,
              ticket.id,
              coordBriefing,
              ticket.createdBy?.id ?? ticket.assignedAgent!.id,
              ticket.conversationId ?? undefined,
              ticket.createdBy?.name,
            ).catch(e => this.logger.warn(`[TicketProcessor] Coordinator alert failed: ${e.message}`))
          })
        }

      } catch (err: any) {
        this.logger.warn(`[TicketProcessor] No-response escalation failed for ticket ${ticket.id.slice(-6)}: ${err.message}`)
      }
    }
  }
}
