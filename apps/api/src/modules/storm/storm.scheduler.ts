import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'
import { StormService } from './storm.service'
import { parse, subDays } from 'date-fns'

@Injectable()
export class StormScheduler {
  private readonly logger = new Logger(StormScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly stormService: StormService,
  ) {}

  // ── Daily run at 7:00 AM UTC ─────────────────────────────────────
  // NOAA SPC reports for the previous day are usually published by ~6 AM UTC

  @Cron('0 7 * * *', { timeZone: 'UTC' })
  async runDailyStormReport() {
    this.logger.log('[Storm Scheduler] Starting daily storm scrape...')

    // Only run for tenants that have an active Storm Analyst agent
    const stormAgents = await this.prisma.agent.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { role: { contains: 'storm', mode: 'insensitive' } },
          { role: { contains: 'analyst', mode: 'insensitive' } },
          { name: { contains: 'arturo', mode: 'insensitive' } },
        ],
      },
      select: { tenantId: true, tenant: { select: { name: true, isActive: true } } },
      distinct: ['tenantId'],
    })

    const activeTenants = stormAgents.filter(a => a.tenant?.isActive)
    this.logger.log(`[Storm Scheduler] Found ${activeTenants.length} tenant(s) with Storm Analyst`)

    for (const { tenantId, tenant } of activeTenants) {
      try {
        await this.stormService.generateAndPostBriefing(tenantId)
        this.logger.log(`[Storm Scheduler] Completed for tenant: ${tenant?.name}`)
      } catch (err: any) {
        this.logger.error(`[Storm Scheduler] Failed for tenant ${tenant?.name}: ${err.message}`)
      }
    }

    this.logger.log(`[Storm Scheduler] Daily run complete for ${activeTenants.length} tenant(s).`)
  }

  // ── Task-triggered storm report ──────────────────────────────────
  // Poll every 2 minutes for pending storm-related tasks assigned to the analyst

  @Cron('*/2 * * * *')
  async processStormTasks() {
    const stormTasks = await this.prisma.task.findMany({
      where: {
        status: 'PENDING',
        // Only pick up tasks assigned to an active storm analyst agent
        agent: {
          status: 'ACTIVE',
          OR: [
            { role: { contains: 'storm', mode: 'insensitive' } },
            { role: { contains: 'analyst', mode: 'insensitive' } },
            { name: { contains: 'arturo', mode: 'insensitive' } },
          ],
        },
        title: {
          contains: 'storm',
          mode: 'insensitive',
        },
      },
      include: { agent: { select: { id: true, name: true, tenantId: true } } },
      take: 10,
    })

    for (const task of stormTasks) {
      try {
        // Mark as in-progress immediately
        await this.prisma.task.update({
          where: { id: task.id },
          data: { status: 'IN_PROGRESS' },
        })

        // Parse optional target date from task description
        let targetDate: Date | undefined
        if (task.description) {
          const match = task.description.match(/(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/)
          if (match) {
            const parsed = new Date(match[1])
            if (!isNaN(parsed.getTime())) targetDate = parsed
          }
        }

        await this.stormService.generateAndPostBriefing(task.tenantId, targetDate)

        await this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'COMPLETED',
            description: (task.description ?? '') + `\n\n✅ Storm report generated and posted.`,
          },
        })

        this.logger.log(`[Storm Scheduler] Task ${task.id} completed for tenant ${task.tenantId}`)
      } catch (err: any) {
        this.logger.error(`[Storm Scheduler] Task ${task.id} failed: ${err.message}`)
        await this.prisma.task.update({
          where: { id: task.id },
          data: { status: 'FAILED' },
        }).catch(() => null)
      }
    }
  }
}
