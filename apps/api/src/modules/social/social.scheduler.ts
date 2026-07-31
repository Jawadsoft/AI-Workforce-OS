import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { SocialService } from './social.service'
import { PrismaService } from '../../common/prisma/prisma.service'

@Injectable()
export class SocialScheduler {
  private readonly logger = new Logger(SocialScheduler.name)

  constructor(
    private readonly social: SocialService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processDuePosts() {
    try {
      await this.social.processDuePosts()
    } catch (err) {
      this.logger.error(`Social post scheduler error: ${err}`)
    }
  }

  // Pull real engagement metrics (likes/comments/shares) for recently published
  // posts every 6 hours, per tenant with a connected Facebook/Instagram account.
  @Cron('0 */6 * * *')
  async refreshAnalytics() {
    try {
      const accounts = await this.prisma.socialAccount.findMany({
        where: { isActive: true, platform: { in: ['facebook', 'instagram'] } },
        select: { tenantId: true },
        distinct: ['tenantId'],
      })
      for (const { tenantId } of accounts) {
        try {
          const result = await this.social.refreshAnalytics(tenantId)
          if (result.updated) {
            this.logger.log(`[Analytics] tenant ${tenantId}: refreshed ${result.updated}/${result.checked} posts`)
          }
        } catch (err: any) {
          this.logger.warn(`[Analytics] tenant ${tenantId} failed: ${err.message}`)
        }
      }
    } catch (err: any) {
      this.logger.error(`Social analytics scheduler error: ${err.message}`)
    }
  }
}
