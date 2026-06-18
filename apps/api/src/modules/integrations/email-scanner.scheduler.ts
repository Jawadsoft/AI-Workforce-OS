import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'
import { IntegrationsService } from './integrations.service'

@Injectable()
export class EmailScannerScheduler {
  private readonly logger = new Logger(EmailScannerScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runEmailScan() {
    this.logger.log('Running scheduled email scan for all tenants...')
    try {
      const tenants = await this.prisma.connectedAccount.findMany({
        where: { status: 'active' },
        select: { tenantId: true },
        distinct: ['tenantId'],
      })

      for (const { tenantId } of tenants) {
        try {
          await this.integrations.scanEmailsForTenant(tenantId)
        } catch (err: any) {
          this.logger.error(`Email scan failed for tenant ${tenantId}: ${err.message}`)
        }
      }

      this.logger.log(`Email scan completed for ${tenants.length} tenants`)
    } catch (err: any) {
      this.logger.error(`Scheduled email scan failed: ${err.message}`)
    }
  }
}
