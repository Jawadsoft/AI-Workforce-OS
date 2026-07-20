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

  /**
   * Inspection day handler — runs every minute.
   *
   * When a SCHEDULED pipeline ticket's followUpAt (= inspection date) is reached:
   *   1. Marks the current stage COMPLETED (e.g. Hanna — Inspection Scheduling done)
   *   2. Calls pipelineAdvance → auto-creates the next stage ticket (e.g. Jared — Field Inspection)
   *
   * For non-pipeline SCHEDULED tickets (no pipelineStageIndex): flips to OPEN as before
   * so the assigned agent can pick it up normally.
   */
  @Cron('* * * * *')
  async flipScheduledTickets() {
    const now = new Date()
    const tickets = await this.prisma.activityTicket.findMany({
      where: {
        status: 'SCHEDULED',
        followUpAt: { lte: now },
        assignedAgentId: { not: null },
        tenant: { isActive: true },
      },
      include: {
        assignedAgent: { select: { id: true, name: true, role: true, tenantId: true } },
      },
      take: 20,
    })

    for (const t of tickets) {
      const log = (t.activityLog as any[]) ?? []
      const meta = (t.metadata as any) ?? {}
      const ticketNum = String(t.ticketNumber ?? '').padStart(4, '0')
      const isPipeline = meta.pipelineStageIndex !== undefined

      try {
        if (isPipeline && t.assignedAgent) {
          // Pipeline ticket — mark stage COMPLETED and advance to next stage
          const inspectionDate = t.followUpAt
            ? new Date(t.followUpAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
            : 'today'

          await this.prisma.activityTicket.update({
            where: { id: t.id },
            data: {
              status: 'COMPLETED',
              resolvedAt: now,
              updatedAt: now,
              activityLog: [
                ...log,
                {
                  agentName: 'System',
                  agentId: 'system',
                  action: 'STAGE_COMPLETED',
                  note: `Inspection date reached (${inspectionDate}). Stage auto-completed — advancing pipeline to next stage.`,
                  timestamp: now.toISOString(),
                },
              ] as any,
            },
          })

          // Advance pipeline — creates next stage ticket for the right agent
          setImmediate(() => {
            this.chat.pipelineAdvance(
              t.tenantId,
              { ...t, status: 'COMPLETED', metadata: meta },
              t.assignedAgent!,
              `Inspection scheduled for ${inspectionDate}. Advancing to next stage.`,
            ).catch(e => this.logger.warn(`[TicketProcessor] pipelineAdvance failed for #${ticketNum}: ${e.message}`))
          })

          this.logger.log(`[TicketProcessor] Ticket #${ticketNum} inspection date reached — stage COMPLETED, pipeline advancing`)
        } else {
          // Non-pipeline SCHEDULED ticket — just flip to OPEN for the agent
          await this.prisma.activityTicket.update({
            where: { id: t.id },
            data: {
              status: 'OPEN',
              updatedAt: now,
              activityLog: [
                ...log,
                {
                  agentName: 'System',
                  agentId: 'system',
                  action: 'AUTO_FLIPPED_TO_OPEN',
                  note: 'followUpAt reached — ticket re-opened for agent processing.',
                  timestamp: now.toISOString(),
                },
              ] as any,
            },
          })
          this.logger.log(`[TicketProcessor] Ticket #${ticketNum} auto-flipped SCHEDULED → OPEN (followUpAt reached)`)
        }
      } catch (err: any) {
        this.logger.warn(`[TicketProcessor] flipScheduledTickets failed for #${ticketNum}: ${err.message}`)
      }
    }
  }

  @Cron('* * * * *')
  async processOpenTickets(force = false) {
    const twoMinutesAgo    = new Date(Date.now() -  2 * 60 * 1000)
    const ninetySecondsAgo = new Date(Date.now() - 90 * 1000)
    const fourHoursAgo     = new Date(Date.now() -  4 * 60 * 60 * 1000)
    const sevenDaysAgo     = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const now              = new Date()

    // Two-tier fetch:
    // Tier 1 — OPEN tickets: never been woken, pick up within 7 days of creation.
    // Tier 2 — IN_PROGRESS: 4-hour cooldown (force=true uses 90s minimum to prevent duplicate emails).
    // Tier 3 — ESCALATED: 2-min cooldown, up to 30 days old.
    //
    // SKIP: AWAITING_CUSTOMER, AWAITING_AGENT, SCHEDULED, COMPLETED, CANCELLED
    const [freshTickets, idleInProgress, idleEscalated] = await Promise.all([
      this.prisma.activityTicket.findMany({
        where: {
          status: 'OPEN',
          assignedAgentId: { not: null },
          tenant: { isActive: true },
          createdAt: { gte: sevenDaysAgo },
          OR: [
            { followUpAt: null },
            { followUpAt: { lte: now } },
          ],
        },
        include: {
          assignedAgent: { select: { id: true, name: true, role: true, tenantId: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ priority: 'desc' }, { followUpAt: 'asc' }, { createdAt: 'asc' }],
        take: 10,
      }),
      // IN_PROGRESS: 4-hour cooldown normally; even with force=true keep a 90-second minimum
      // so tickets that were just woken (e.g. by pipelineAdvance) are not immediately re-woken
      // by a simultaneous processOpenTickets call — which would send duplicate emails.
      this.prisma.activityTicket.findMany({
        where: {
          status: 'IN_PROGRESS',
          assignedAgentId: { not: null },
          tenant: { isActive: true },
          updatedAt: { lt: force ? ninetySecondsAgo : fourHoursAgo },
        },
        include: {
          assignedAgent: { select: { id: true, name: true, role: true, tenantId: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ priority: 'desc' }, { followUpAt: 'asc' }, { createdAt: 'asc' }],
        take: force ? 50 : 5,
      }),
      // ESCALATED: 2-min cooldown, up to 30 days old
      this.prisma.activityTicket.findMany({
        where: {
          status: 'ESCALATED',
          assignedAgentId: { not: null },
          tenant: { isActive: true },
          createdAt: { gte: thirtyDaysAgo },
          updatedAt: { lt: twoMinutesAgo },
        },
        include: {
          assignedAgent: { select: { id: true, name: true, role: true, tenantId: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ priority: 'desc' }, { followUpAt: 'asc' }, { createdAt: 'asc' }],
        take: 5,
      }),
    ])
    // Merge all tiers, deduplicating by ticket ID
    const idleTickets = [...idleInProgress, ...idleEscalated]

    // Merge: fresh (OPEN) tickets first, then idle in-progress ones
    // De-duplicate by ticket ID in case both queries somehow return the same row
    const seen = new Set<string>()
    const tickets = [...freshTickets, ...idleTickets].filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    }).slice(0, force ? 50 : 10)  // forced runs process all agents; cron caps at 10

    if (!tickets.length) {
      this.logger.log(`[TicketProcessor] No actionable tickets found${force ? ' (forced run)' : ''}`)
      return
    }

    this.logger.log(`[TicketProcessor] Processing ${tickets.length} pending ticket(s)${force ? ' (forced run — cooldowns bypassed)' : ''}`)

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

        // Fetch tenant playbook to inject stage-specific context into the briefing
        const tenantSettings = await this.prisma.tenant.findUnique({
          where: { id: ticket.tenantId },
          select: { settings: true },
        })
        const playbook = (tenantSettings?.settings as any)?.brain?.operationalPlaybook
        const stages: any[] = playbook?.pipelineStages ?? []
        const stageIndex: number = (ticket.metadata as any)?.pipelineStageIndex ?? -1
        const currentStage = stageIndex >= 0 ? stages[stageIndex] : null
        const stageContext = currentStage ? [
          ``,
          `📋 PIPELINE STAGE ${stageIndex + 1}: ${currentStage.name}`,
          currentStage.completion ? `🎯 Your job: ${currentStage.completion}` : '',
          currentStage.completion ? `✅ Call update_ticket(COMPLETED) as soon as the above is done.` : '',
          currentStage.handoffTo  ? `➡️ When you mark COMPLETED, system auto-creates next ticket for: ${currentStage.handoffTo}` : '',
          currentStage.sla        ? `⏱️ SLA: ${currentStage.sla}` : '',
        ].filter(Boolean).join('\n') : ''

        // Bump updatedAt NOW before waking — resets the 4-hour cooldown
        await this.prisma.activityTicket.update({
          where: { id: ticket.id },
          data: { updatedAt: new Date() },
        })

        const effectiveEmail = ticket.contactEmail || null

        // Determine the primary action needed based on nextAction text and stage index
        const nextAction = (ticket.nextAction || '').toLowerCase()
        const isStage0 = stageIndex === 0

        // A Stage 0 ticket needs an outreach email ONLY on first contact.
        // If the customer has already replied (nextAction contains "replied" or "continue"),
        // the agent should craft a conversational reply — not re-send the intro email.
        const isInitialOutreach = isStage0
          && !nextAction.includes('replied')
          && !nextAction.includes('continue the conversation')
          && !nextAction.includes('answer their question')

        const needsEmail = isInitialOutreach
          || nextAction.includes('send email')
          || nextAction.includes('outreach')
          || nextAction.includes('contact_customer')
          || (stageIndex === 2 && (nextAction.includes('schedule') || nextAction.includes('confirm'))) // Hanna
        const isReplyMode = isStage0 && !isInitialOutreach  // customer replied, agent should respond
        const needsSlots = !isStage0 && !isInitialOutreach && (nextAction.includes('book') || nextAction.includes('slot') || nextAction.includes('appointment'))

        const ticketShortId = ticket.id.slice(-6)
        const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const tenantName = (tenantSettings?.settings as any)?.brain?.companyName || 'our company'
        const customerName = ticket.contactRef || 'there'

        // Pre-written email bodies — provided for all needsEmail stages so the agent never sends a blank email
        const d1 = threeDaysFromNow
        const d2 = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const d3 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const phoneStr = ticket.contactPhone ? ` or call us at ${ticket.contactPhone}` : ''
        const prewrittenMessage = isInitialOutreach
          ? `Hi ${customerName},\n\nMy name is from ${tenantName}. We noticed your property may have been affected by a recent storm in your area, and we would like to offer you a free roof inspection.\n\nThere is no cost or obligation — our specialist will assess any damage and walk you through your options, including how to file an insurance claim if needed.\n\nWould you be available for a quick call or visit? Please reply to this email${phoneStr} and we will arrange a convenient time.\n\nBest regards,\n${tenantName}`
          : stageIndex === 2
            ? `Hi ${customerName},\n\nI am reaching out from ${tenantName} to confirm your upcoming roof inspection. Could you let me know which of the following dates works best for you?\n\n• ${d1}\n• ${d2}\n• ${d3}\n\nPlease reply to this email${phoneStr}.\n\nBest regards,\n${tenantName}`
            : `Hi ${customerName},\n\nI am following up on your roofing project with ${tenantName}. We wanted to keep you informed on the progress and check if you have any questions at this stage.\n\nPlease reply to this email${phoneStr} and we will be happy to assist.\n\nBest regards,\n${tenantName}`

        const briefing = [
          `TICKET #${ticketNum}: "${ticket.title}"`,
          ticket.contactRef   ? `Customer: ${ticket.contactRef}` : '',
          effectiveEmail      ? `Customer email: ${effectiveEmail}` : '',
          ticket.contactPhone ? `Customer phone: ${ticket.contactPhone}` : '',
          ``,
          isReplyMode ? [
            // Customer already replied — agent must continue the conversation, then mark COMPLETED
            `CONTEXT: ${ticket.nextAction || 'Customer replied to your previous email.'}`,
            ``,
            `YOUR TASK:`,
            `1. Reply to the customer by calling contact_customer with EXACTLY these parameters:`,
            `{`,
            `  "contactEmail": "${effectiveEmail || ''}",`,
            `  "contactName": "${customerName}",`,
            `  "ticketId": "${ticketShortId}",`,
            `  "subject": "Re: Free Roof Inspection — ${tenantName}",`,
            `  "message": "<write a helpful reply addressing their question or comment>"`,
            `}`,
            `DO NOT pass sessionId. Use contactEmail only.`,
            ``,
            `2. Only call update_ticket AFTER the reply is sent:`,
            `   - If conversation is ongoing: update_ticket(ticketId: "${ticketShortId}", status: "AWAITING_CUSTOMER")`,
            `   - If lead is FULLY QUALIFIED (customer confirmed interest and ready to proceed): update_ticket(ticketId: "${ticketShortId}", status: "COMPLETED")`,
            ``,
            `A lead is fully qualified when: customer acknowledged damage, is interested in the free inspection, and has no remaining objections or questions.`,
          ].join('\n') : needsEmail ? [
            `STEP 1 — Send email now. Call contact_customer with EXACTLY these parameters (do not add sessionId):`,
            `{`,
            `  "contactEmail": "${effectiveEmail || ''}",`,
            `  "contactName": "${customerName}",`,
            `  "ticketId": "${ticketShortId}",`,
            `  "subject": "${isInitialOutreach ? `Free Roof Inspection — ${tenantName}` : stageIndex === 2 ? `Roof Inspection Scheduling — ${tenantName}` : `Project Update — ${tenantName}`}",`,
            `  "message": "${prewrittenMessage.replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`,
            `}`,
            `IMPORTANT: Use contactEmail only. Do NOT pass sessionId.`,
            ``,
            `STEP 2 — Only AFTER the email sends successfully, call update_ticket:`,
            `{`,
            `  "ticketId": "${ticketShortId}",`,
            `  "status": "AWAITING_CUSTOMER",`,
            `  "followUpAt": "${threeDaysFromNow}"`,
            `}`,
            ``,
            `If the email fails, do NOT call update_ticket. Report the error instead.`,
          ].join('\n') : needsSlots ? [
            `YOUR TASK:`,
            `1. Call get_available_slots`,
            `2. Call contact_customer with: contactEmail="${effectiveEmail || ''}", contactName="${customerName}", ticketId="${ticketShortId}", message=list of available dates. Do NOT pass sessionId.`,
            `3. Only after email succeeds: call update_ticket(ticketId: "${ticketShortId}", status: "SCHEDULED")`,
          ].join('\n') : [
            `YOUR TASK: ${ticket.nextAction || 'Review and action this ticket'}`,
            ``,
            `When ALL work is done → call update_ticket(ticketId: "${ticketShortId}", status: "COMPLETED", note: "<brief summary of what you completed>")`,
            `This will automatically create the next stage ticket for the next team member.`,
          ].join('\n'),
          stageContext,
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
    // Pipeline tickets are auto-assigned to specific agents — give them 4 hours before escalating
    // Non-pipeline (ad-hoc) tickets escalate after 2 hours
    const twoHoursAgo   = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const sevenDaysAgo  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Only tickets that are still OPEN (never progressed) AND were created 2+ hours ago
    const tickets = await this.prisma.activityTicket.findMany({
      where: {
        status: 'OPEN',
        assignedAgentId: { not: null },
        tenant: { isActive: true },
        createdAt: { gte: sevenDaysAgo, lte: twoHoursAgo },
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

      // Pipeline tickets have a specific designated agent — give them 4 hours before escalating
      const meta = (ticket.metadata as Record<string, unknown>) ?? {}
      const stageIdx = meta.pipelineStageIndex as number | undefined
      if (stageIdx !== undefined) {
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000)
        if (new Date(ticket.createdAt) > fourHoursAgo) continue // not old enough for pipeline tickets
      }

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

  /**
   * AWAITING_CUSTOMER follow-up loop — runs every 30 minutes.
   *
   * Finds AWAITING_CUSTOMER pipeline tickets whose followUpAt has passed and:
   *  - Attempt 1–3: wakes the assigned agent to send a follow-up email, resets followUpAt +3 days
   *  - Attempt 4+:  escalates to ESCALATED and notifies owner
   *
   * Tracks attempt count in metadata.followUpAttempts.
   * Only fires on pipeline tickets (metadata.pipelineStageIndex is set).
   */
  @Cron('0 */30 * * * *')
  async checkAwaitingFollowUp() {
    const now = new Date()
    const tickets = await this.prisma.activityTicket.findMany({
      where: {
        status: 'AWAITING_CUSTOMER',
        followUpAt: { lte: now },
        tenant: { isActive: true },
      },
      include: {
        assignedAgent: { select: { id: true, name: true, role: true, tenantId: true } },
      },
      orderBy: { followUpAt: 'asc' },
      take: 20,
    })

    if (!tickets.length) return

    for (const ticket of tickets) {
      // Only act on pipeline tickets
      const meta = (ticket.metadata as Record<string, unknown>) ?? {}
      if ((meta.pipelineStageIndex as number | undefined) === undefined) continue
      if (!ticket.assignedAgent) continue

      const attempts = (meta.followUpAttempts as number | undefined) ?? 0
      const ticketNum = String(ticket.ticketNumber ?? '').padStart(4, '0')
      const effectiveEmail = ticket.contactEmail || null

      try {
        if (attempts >= 3) {
          // Escalate — customer has not responded after 3 follow-ups
          this.logger.warn(`[TicketProcessor] Ticket #${ticketNum} escalated — no customer response after ${attempts} follow-ups`)
          const log = (ticket.activityLog as any[]) ?? []
          await this.prisma.activityTicket.update({
            where: { id: ticket.id },
            data: {
              status: 'ESCALATED',
              nextAction: `Escalated — customer did not respond after ${attempts} follow-up attempts. Manual intervention required.`,
              updatedAt: now,
              activityLog: [...log, {
                agentName: 'System', agentId: 'system',
                action: 'ESCALATED',
                note: `Auto-escalated after ${attempts} unanswered follow-up attempts.`,
                timestamp: now.toISOString(),
              }] as any,
            },
          })
        } else {
          // Send follow-up
          const nextAttempt = attempts + 1
          const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

          this.logger.log(`[TicketProcessor] Follow-up #${nextAttempt} for ticket #${ticketNum} (${ticket.assignedAgent.name})`)

          const briefing = [
            `TICKET #${ticketNum}: "${ticket.title}"`,
            `Customer: ${ticket.contactRef || 'Customer'}`,
            effectiveEmail ? `Customer email: ${effectiveEmail}` : '',
            ``,
            `TASK: This is follow-up attempt #${nextAttempt}. The customer has not responded to the previous email.`,
            `STEP 1 — Call contact_customer with:`,
            `  contactEmail: "${effectiveEmail || ''}"`,
            `  contactName: "${ticket.contactRef || 'Customer'}"`,
            `  message: "Hi ${ticket.contactRef || 'there'}, just following up on our previous message about scheduling your roof inspection. Are any of the dates we mentioned still convenient, or would you prefer a different time? Please let us know at your earliest convenience."`,
            `STEP 2 — Call update_ticket(ticketId: "${ticket.id.slice(-6)}", status: "AWAITING_CUSTOMER", followUpAt: "${threeDaysFromNow.toISOString().split('T')[0]}")`,
          ].filter(Boolean).join('\n')

          // Update metadata before waking agent
          const log = (ticket.activityLog as any[]) ?? []
          await this.prisma.activityTicket.update({
            where: { id: ticket.id },
            data: {
              followUpAt: threeDaysFromNow,
              metadata: { ...(meta as any), followUpAttempts: nextAttempt } as any,
              updatedAt: new Date(Date.now() - 5 * 60 * 1000), // backdate so autoWake cooldown is bypassed
              activityLog: [...log, {
                agentName: 'System', agentId: 'system',
                action: 'FOLLOW_UP_QUEUED',
                note: `Auto follow-up #${nextAttempt} queued. Next check: ${threeDaysFromNow.toLocaleDateString('en-GB')}.`,
                timestamp: now.toISOString(),
              }] as any,
            },
          })

          setImmediate(() => {
            this.chat.autoWakeAgent(
              ticket.tenantId,
              ticket.assignedAgent!.id,
              ticket.id,
              briefing,
              ticket.assignedAgent!.id,
              ticket.conversationId ?? undefined,
            ).catch(e => this.logger.warn(`[TicketProcessor] Follow-up wake failed for #${ticketNum}: ${e.message}`))
          })
        }
      } catch (err: any) {
        this.logger.warn(`[TicketProcessor] Follow-up check failed for ticket ${ticket.id.slice(-6)}: ${err.message}`)
      }
    }
  }

  async runFollowUpCheck() {
    return this.checkAwaitingFollowUp()
  }
}
