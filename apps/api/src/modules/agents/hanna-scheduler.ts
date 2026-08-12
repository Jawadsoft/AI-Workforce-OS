import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'
import { ChatService } from '../chat/chat.service'
import { NotificationService } from '../notifications/notification.service'
import { AutonomyService } from '../../common/autonomy/autonomy.service'

/**
 * Hanna Scheduler — wakes Hanna (Executive Assistant) agents daily.
 *
 * Runs every day at 8:00 AM tenant-local time (approximated as UTC morning).
 * For each active tenant that has a Hanna-type agent, it:
 *  1. Scans for idle tickets (no update in 3+ days)
 *  2. Scans for supplements idle for 5+ days
 *  3. Wakes the Hanna agent with a full briefing so she can take action
 *
 * Safety: only processes tenants with an active executive assistant / Hanna agent.
 * Max 1 wake per Hanna agent per run.
 */
@Injectable()
export class HannaScheduler {
  private readonly logger = new Logger(HannaScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly notifications: NotificationService,
    private readonly autonomy: AutonomyService,
  ) {}

  @Cron('0 8 * * *')
  async runDailyBriefing() {
    this.logger.log('[HannaScheduler] Running daily briefing...')

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const fiveDaysAgo  = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)

    // Find all Hanna-type agents across active tenants
    const hannaAgents = await this.prisma.agent.findMany({
      where: {
        status: 'ACTIVE',
        tenant: { isActive: true },
        OR: [
          { name:  { contains: 'hanna', mode: 'insensitive' } },
          { role:  { contains: 'executive assistant', mode: 'insensitive' } },
          { role:  { contains: 'project manager', mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, role: true, tenantId: true },
    })

    if (!hannaAgents.length) {
      this.logger.log('[HannaScheduler] No Hanna-type agents found — skipping')
      return
    }

    for (const hanna of hannaAgents) {
      try {
        if (!(await this.autonomy.canAutoProcess(hanna.tenantId))) continue

        // Stale open/in-progress tickets
        const staleTickets = await this.prisma.activityTicket.findMany({
          where: {
            tenantId: hanna.tenantId,
            status: { in: ['OPEN', 'IN_PROGRESS', 'AWAITING_AGENT'] },
            updatedAt: { lt: threeDaysAgo },
          },
          orderBy: { updatedAt: 'asc' },
          take: 20,
          select: {
            id: true, ticketNumber: true, title: true, status: true,
            priority: true, contactRef: true, nextAction: true, followUpAt: true,
            updatedAt: true,
            assignedAgent: { select: { name: true, role: true } },
          },
        })

        // Supplement tickets idle for 5+ days
        const idleSupplements = await this.prisma.activityTicket.findMany({
          where: {
            tenantId: hanna.tenantId,
            title: { contains: 'supplement', mode: 'insensitive' },
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            updatedAt: { lt: fiveDaysAgo },
          },
          orderBy: { updatedAt: 'asc' },
          take: 10,
          select: {
            id: true, ticketNumber: true, title: true, status: true,
            contactRef: true, updatedAt: true,
            assignedAgent: { select: { name: true } },
          },
        })

        // Overdue follow-ups
        const overdueFollowUps = await this.prisma.activityTicket.findMany({
          where: {
            tenantId: hanna.tenantId,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            followUpAt: { lt: new Date() },
          },
          orderBy: { followUpAt: 'asc' },
          take: 10,
          select: {
            id: true, ticketNumber: true, title: true, followUpAt: true,
            contactRef: true, nextAction: true,
            assignedAgent: { select: { name: true } },
          },
        })

        const hasWork = staleTickets.length > 0 || idleSupplements.length > 0 || overdueFollowUps.length > 0
        if (!hasWork) {
          this.logger.log(`[HannaScheduler] ${hanna.name} — nothing to action today`)
          continue
        }

        const formatDate = (d: Date | null) => d ? new Date(d).toLocaleDateString('en-GB') : 'unknown'
        const daysSince  = (d: Date) => Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24))

        const staleSection = staleTickets.length ? [
          `\n🔴 STALE TICKETS (no update in 3+ days) — ${staleTickets.length} item(s):`,
          ...staleTickets.map(t =>
            `• #${t.ticketNumber} "${t.title}" — ${t.status} — ${daysSince(t.updatedAt)}d idle` +
            (t.contactRef ? ` — Contact: ${t.contactRef}` : '') +
            (t.assignedAgent ? ` — Assigned: ${t.assignedAgent.name}` : '') +
            (t.nextAction ? `\n  Next action: ${t.nextAction}` : '')
          ),
        ].join('\n') : ''

        const supplementSection = idleSupplements.length ? [
          `\n⚠️ IDLE SUPPLEMENTS (5+ days with no update) — ${idleSupplements.length} item(s):`,
          ...idleSupplements.map(t =>
            `• #${t.ticketNumber} "${t.title}" — ${daysSince(t.updatedAt)}d idle` +
            (t.contactRef ? ` — Contact: ${t.contactRef}` : '') +
            (t.assignedAgent ? ` — Assigned: ${t.assignedAgent.name}` : '')
          ),
        ].join('\n') : ''

        const overdueSection = overdueFollowUps.length ? [
          `\n🟡 OVERDUE FOLLOW-UPS — ${overdueFollowUps.length} item(s):`,
          ...overdueFollowUps.map(t =>
            `• #${t.ticketNumber} "${t.title}" — due ${formatDate(t.followUpAt)}` +
            (t.contactRef ? ` — Contact: ${t.contactRef}` : '') +
            (t.nextAction ? `\n  Next action: ${t.nextAction}` : '')
          ),
        ].join('\n') : ''

        const briefing = [
          `🗓️ DAILY BRIEFING — ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
          ``,
          `You have ${staleTickets.length} stale job(s), ${idleSupplements.length} idle supplement(s), and ${overdueFollowUps.length} overdue follow-up(s) that need your attention.`,
          staleSection,
          supplementSection,
          overdueSection,
          ``,
          `YOUR TASKS:`,
          `1. Review all items above using get_team_activity`,
          `2. For each stale ticket — decide: follow up with customer, reassign, or escalate`,
          `3. For each idle supplement — contact the relevant team member or customer to get it moving`,
          `4. For each overdue follow-up — send a follow-up message or update the ticket status`,
          `5. Generate a brief daily summary for the business owner`,
          ``,
          `Use contact_customer to send follow-up messages. Use update_ticket to mark progress.`,
          `DO NOT create new tickets — update existing ones only.`,
        ].filter(s => s !== null).join('\n')

        this.logger.log(`[HannaScheduler] Waking ${hanna.name} — ${staleTickets.length} stale, ${idleSupplements.length} idle supplements, ${overdueFollowUps.length} overdue`)

        await this.chat.wakeAgentWithBriefing(hanna.tenantId, hanna.id, briefing)

        // Also email the business owner with a summary digest
        const digestHtml = `
          <h2>📋 Daily Operations Digest</h2>
          <p>Your AI workforce has reviewed all open jobs. Here's a snapshot:</p>
          <ul>
            <li><strong>Stale jobs (3+ days idle):</strong> ${staleTickets.length}</li>
            <li><strong>Idle supplements (5+ days):</strong> ${idleSupplements.length}</li>
            <li><strong>Overdue follow-ups:</strong> ${overdueFollowUps.length}</li>
          </ul>
          ${staleTickets.length ? `<h3>🔴 Stale Jobs</h3><ul>${staleTickets.map(t => `<li>#${t.ticketNumber} — ${t.title} (${t.status}${t.contactRef ? ', ' + t.contactRef : ''})</li>`).join('')}</ul>` : ''}
          ${overdueFollowUps.length ? `<h3>🟡 Overdue Follow-Ups</h3><ul>${overdueFollowUps.map(t => `<li>#${t.ticketNumber} — ${t.title} (due ${t.followUpAt ? new Date(t.followUpAt).toLocaleDateString('en-GB') : 'unknown'})</li>`).join('')}</ul>` : ''}
          <p style="color:#666;font-size:12px;">This is an automated digest from your AI Workforce OS. Log in to take action.</p>
        `
        setImmediate(() => {
          this.notifications.sendDailyDigest(hanna.tenantId, digestHtml)
            .catch(e => this.logger.warn(`[HannaScheduler] Digest email failed: ${e.message}`))
        })
      } catch (err: any) {
        this.logger.error(`[HannaScheduler] Error waking ${hanna.name}: ${err.message}`)
      }
    }
  }
}
