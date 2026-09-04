import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'
import { StormService } from '../storm/storm.service'
import { EmailService } from '../email/email.service'
import { computeNextOccurrence, DEFAULT_US_TIMEZONE } from '../../common/utils/schedule-time.util'

const MAX_FAILURES_BEFORE_DISABLE = 5
const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Polls internal Tasks created via the `create_internal_task` chat tool that
 * carry an `automatedAction` in their metadata (e.g. "email me the daily
 * hail report at 10am") and actually executes them — generating the report
 * and sending it — instead of the agent just promising it in chat.
 *
 * Recurring tasks (metadata.recurring === 'daily') are re-armed with the next
 * day's dueDate after a successful send rather than being marked COMPLETED.
 */
@Injectable()
export class RecurringTaskScheduler {
  private readonly logger = new Logger(RecurringTaskScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storm: StormService,
    private readonly email: EmailService,
  ) {}

  // Tracks which task IDs are currently being processed in this instance to
  // prevent a slow email send from being picked up again on the next 5-min tick.
  private readonly inFlight = new Set<string>()

  @Cron('*/5 * * * *')
  async processAutomatedTasks() {
    const now = new Date()
    const dueTasks = await this.prisma.task.findMany({
      where: {
        status: 'PENDING',
        dueDate: { lte: now },
        metadata: { path: ['automatedAction'], equals: 'email_storm_report' },
      },
      include: { tenant: { select: { name: true, isActive: true } } },
      take: 20,
    })

    if (dueTasks.length === 0) return
    this.logger.log(`[RecurringTask] Found ${dueTasks.length} due automated task(s)`)

    for (const task of dueTasks) {
      if (!task.tenant?.isActive) continue
      if (this.inFlight.has(task.id)) {
        this.logger.warn(`[RecurringTask] Task ${task.id} is still in-flight — skipping this tick`)
        continue
      }
      const taskMeta = (task.metadata as Record<string, any>) ?? {}
      if (taskMeta.paused === true) continue
      this.inFlight.add(task.id)
      try {
        await this.runEmailStormReport(task)
      } catch (err: any) {
        this.logger.error(`[RecurringTask] Task ${task.id} failed: ${err.message}`)
        await this.handleFailure(task, err.message)
      } finally {
        this.inFlight.delete(task.id)
      }
    }
  }

  private async runEmailStormReport(task: { id: string; tenantId: string; metadata: unknown }) {
    const meta = (task.metadata as Record<string, any>) ?? {}
    const recipientEmail: string | undefined = meta.recipientEmail
    if (!recipientEmail) throw new Error('Task metadata is missing recipientEmail')

    const filters = meta.reportFilters ?? {}
    const reports = await this.storm.queryReports(task.tenantId, {
      type: filters.type,
      state: filters.state,
      minSize: filters.minSize,
      days: filters.days ?? 1,
      county: filters.county,
    })

    const html = this.buildReportHtml(reports, filters)
    await this.email.send({
      tenantId: task.tenantId,
      to: recipientEmail,
      subject: `Daily Storm Report — ${new Date().toLocaleDateString('en-US')}`,
      html,
    })

    const isRecurring = meta.recurring === 'daily'
    if (isRecurring) {
      const nextDue = computeNextOccurrence(meta.timeOfDay, meta.timezone ?? DEFAULT_US_TIMEZONE, new Date())
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'PENDING',
          dueDate: nextDue,
          metadata: { ...meta, lastSentAt: new Date().toISOString(), failCount: 0, lastError: null },
        },
      })
      this.logger.log(`[RecurringTask] Sent storm report to ${recipientEmail} — next run ${nextDue.toISOString()}`)
    } else {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'COMPLETED', metadata: { ...meta, lastSentAt: new Date().toISOString() } },
      })
      this.logger.log(`[RecurringTask] Sent one-time storm report to ${recipientEmail}`)
    }
  }

  private async handleFailure(task: { id: string; metadata: unknown }, errorMessage: string) {
    const meta = (task.metadata as Record<string, any>) ?? {}
    const failCount = (meta.failCount ?? 0) + 1

    if (failCount >= MAX_FAILURES_BEFORE_DISABLE) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'FAILED', metadata: { ...meta, failCount, lastError: errorMessage } },
      })
      this.logger.error(`[RecurringTask] Task ${task.id} disabled after ${failCount} consecutive failures: ${errorMessage}`)
      return
    }

    // Back off 30 minutes rather than retrying every 5 minutes on persistent errors
    // (e.g. bad SMTP config) — dueDate is pushed forward, task stays PENDING.
    await this.prisma.task.update({
      where: { id: task.id },
      data: { dueDate: new Date(Date.now() + RETRY_AFTER_FAILURE_MS), metadata: { ...meta, failCount, lastError: errorMessage } },
    })
  }

  private buildReportHtml(reports: any[], filters: Record<string, any>): string {
    const filterDesc = [
      filters.state ? `State: ${filters.state}` : null,
      filters.minSize ? `Min hail: ${filters.minSize}"` : null,
      `Last ${filters.days ?? 1} day${(filters.days ?? 1) === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ')

    if (reports.length === 0) {
      return this.wrapEmail(`
        <h2 style="color:#1e293b;margin-bottom:8px;">⛈️ Daily Storm Report</h2>
        <p style="color:#64748b;font-size:13px;">${filterDesc}</p>
        <p style="color:#64748b;">No hail, tornado, or wind reports found for this period.</p>
      `)
    }

    const byType = reports.reduce((acc: Record<string, number>, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1
      return acc
    }, {})
    const largestHail = reports
      .filter((r) => r.type === 'hail' && r.size)
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]

    const rows = reports.slice(0, 15).map((r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-transform:capitalize;">${r.type}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${r.size ? `${r.size.toFixed(2)}"` : '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${r.county ? `${r.county} County, ` : ''}${r.state ?? ''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${new Date(r.reportDate).toLocaleDateString('en-US')}</td>
      </tr>
    `).join('')

    return this.wrapEmail(`
      <h2 style="color:#1e293b;margin-bottom:8px;">⛈️ Daily Storm Report</h2>
      <p style="color:#64748b;font-size:13px;">${filterDesc}</p>
      <p style="color:#1e293b;">
        <strong>${reports.length} event${reports.length === 1 ? '' : 's'}</strong>
        (${Object.entries(byType).map(([t, c]) => `${c} ${t}`).join(', ')})
        ${largestHail ? ` · Largest hail: <strong>${largestHail.size?.toFixed(2)}"</strong> in ${largestHail.county ?? largestHail.state}` : ''}
      </p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;">
        <thead>
          <tr style="background:#f8fafc;text-align:left;">
            <th style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Type</th>
            <th style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Size</th>
            <th style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Location</th>
            <th style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Date</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${reports.length > 15 ? `<p style="color:#94a3b8;font-size:12px;margin-top:8px;">…and ${reports.length - 15} more events not shown.</p>` : ''}
    `)
  }

  private wrapEmail(content: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">⚡ AI Workforce OS</h1>
    </div>
    <div style="padding:32px;">
      ${content}
    </div>
    <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">Automated daily report · AI Workforce OS</p>
    </div>
  </div>
</body>
</html>`
  }
}
