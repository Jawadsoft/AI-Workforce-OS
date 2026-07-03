import { Controller, Post, Param, UseGuards, Request, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { TicketProcessorScheduler } from './ticket-processor.scheduler'
import { CrmLeadScannerScheduler } from './crm-lead-scanner.scheduler'
import { EmailScannerScheduler } from '../integrations/email-scanner.scheduler'

/**
 * Operations Controller — manual triggers for background schedulers.
 *
 * Allows tenant users (and admins) to fire any background scheduler
 * on demand without waiting for the next cron tick.
 *
 * POST /api/v1/operations/run/crm-scan          → Import new CRM leads now
 * POST /api/v1/operations/run/process-tickets   → Wake agents for all pending tickets now
 * POST /api/v1/operations/run/flip-scheduled    → Re-open any SCHEDULED tickets whose date has passed
 * POST /api/v1/operations/run/escalation-check → Run no-response escalation check now
 */
@ApiTags('Operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('operations')
export class OperationsController {
  constructor(
    private readonly ticketProcessor: TicketProcessorScheduler,
    private readonly crmScanner: CrmLeadScannerScheduler,
    private readonly emailScanner: EmailScannerScheduler,
  ) {}

  @Post('run/:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger a background scheduler action' })
  @ApiParam({
    name: 'action',
    enum: ['crm-scan', 'process-tickets', 'flip-scheduled', 'escalation-check'],
    description: 'Which scheduler to run immediately',
  })
  async runAction(@Param('action') action: string, @Request() _req: any) {
    switch (action) {
      case 'crm-scan':
        await this.crmScanner.scanAllTenants()
        return { ok: true, action, message: 'CRM lead scan triggered. Check tickets in a few seconds.' }

      case 'process-tickets':
        await this.ticketProcessor.processOpenTickets(true)  // force=true bypasses 4-hour IN_PROGRESS cooldown
        return { ok: true, action, message: 'Ticket processor triggered (force mode). All OPEN and IN_PROGRESS tickets are being actioned now.' }

      case 'flip-scheduled':
        await this.ticketProcessor.flipScheduledTickets()
        return { ok: true, action, message: 'Scheduled ticket flip triggered. Any past-due SCHEDULED tickets are now OPEN.' }

      case 'escalation-check':
        await this.ticketProcessor.checkNoResponseEscalation()
        return { ok: true, action, message: 'Escalation check triggered. Unacknowledged tickets will be escalated.' }

      case 'email-scan':
        await this.emailScanner.runEmailScan()
        return { ok: true, action, message: 'Email inbox scanned. Any customer replies will have reopened their tickets.' }

      case 'follow-up-check':
        await this.ticketProcessor.runFollowUpCheck()
        return { ok: true, action, message: 'Follow-up check triggered. Overdue AWAITING_CUSTOMER tickets will receive a follow-up email.' }

      default:
        throw new BadRequestException(
          `Unknown action "${action}". Valid options: crm-scan, process-tickets, flip-scheduled, escalation-check`,
        )
    }
  }
}
