import {
  Controller, Post, Get, Param, Body, UseGuards, Request,
  HttpCode, HttpStatus, BadRequestException, Inject, forwardRef,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { TicketProcessorScheduler } from './ticket-processor.scheduler'
import { CrmLeadScannerScheduler } from './crm-lead-scanner.scheduler'
import { EmailScannerScheduler } from '../integrations/email-scanner.scheduler'
import { TestJourneyService } from './test-journey.service'
import { ChatService } from '../chat/chat.service'
import { PrismaService } from '../../common/prisma/prisma.service'

@ApiTags('Operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('operations')
export class OperationsController {
  constructor(
    private readonly ticketProcessor: TicketProcessorScheduler,
    private readonly crmScanner: CrmLeadScannerScheduler,
    private readonly emailScanner: EmailScannerScheduler,
    private readonly testJourney: TestJourneyService,
    @Inject(forwardRef(() => ChatService)) private readonly chat: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Scheduler triggers ────────────────────────────────────────────────────

  @Post('run/:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger a background scheduler action' })
  @ApiParam({ name: 'action', enum: ['crm-scan', 'process-tickets', 'flip-scheduled', 'escalation-check', 'email-scan', 'follow-up-check'] })
  async runAction(@Param('action') action: string) {
    switch (action) {
      case 'crm-scan':
        await this.crmScanner.scanAllTenants()
        return { ok: true, action, message: 'CRM lead scan triggered.' }
      case 'process-tickets':
        await this.ticketProcessor.processOpenTickets(true)
        return { ok: true, action, message: 'Ticket processor triggered (force mode). All OPEN and IN_PROGRESS tickets are being actioned now.' }
      case 'flip-scheduled':
        await this.ticketProcessor.flipScheduledTickets()
        return { ok: true, action, message: 'Scheduled ticket flip triggered.' }
      case 'escalation-check':
        await this.ticketProcessor.checkNoResponseEscalation()
        return { ok: true, action, message: 'Escalation check triggered.' }
      case 'follow-up-check':
        await this.ticketProcessor.runFollowUpCheck()
        return { ok: true, action, message: 'Follow-up check triggered.' }
      case 'email-scan':
        await this.emailScanner.runEmailScan()
        return { ok: true, action, message: 'Email inbox scanned.' }
      default:
        throw new BadRequestException(`Unknown action "${action}".`)
    }
  }

  // ── Dev Test Journey ──────────────────────────────────────────────────────

  /** Start the fully automated 22-stage journey (same as node test-full-journey.js) */
  @Post('test-journey/run-full')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[DEV] Run full automated 22-stage journey — same as node test-full-journey.js' })
  async runFullJourney(@Request() req: any, @Body() body?: { customerEmail?: string; customerName?: string; customerPhone?: string; customerAddress?: string }) {
    const tenantId: string = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('No tenant in auth context')
    return this.testJourney.startFullJourney(tenantId, {
      email:   body?.customerEmail,
      name:    body?.customerName,
      phone:   body?.customerPhone,
      address: body?.customerAddress,
    })
  }

  @Post('test-journey/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[DEV] Stop a running test journey' })
  stopFullJourney(@Request() req: any) {
    const tenantId: string = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('No tenant in auth context')
    return this.testJourney.stopFullJourney(tenantId)
  }

  @Post('test-journey/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[DEV] Force-reset a stuck journey — clears in-memory state and cancels open test tickets' })
  forceResetJourney(@Request() req: any) {
    const tenantId: string = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('No tenant in auth context')
    return this.testJourney.forceResetJourney(tenantId)
  }

  /** Poll for live log entries */
  @Get('test-journey/logs')
  @ApiOperation({ summary: '[DEV] Get live log entries for the running test journey' })
  getTestJourneyLogs(@Request() req: any) {
    const tenantId: string = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('No tenant in auth context')
    return {
      status: this.testJourney.getStatus(tenantId),
      logs: this.testJourney.getLogs(tenantId),
    }
  }

  /** List current test journey tickets for step-by-step view */
  @Get('test-journey/tickets')
  @ApiOperation({ summary: '[DEV] List all test journey tickets' })
  async getTestJourneyTickets(@Request() req: any): Promise<object[]> {
    const tenantId: string = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('No tenant in auth context')
    return this.testJourney.getJourneyTickets(tenantId)
  }

  /** Inject a simulated customer reply */
  @Post('test-journey/reply/:ticketId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[DEV] Inject a simulated customer reply' })
  async simulateReply(
    @Request() req: any,
    @Param('ticketId') ticketId: string,
    @Body() body: { reply?: string },
  ) {
    const tenantId: string = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('No tenant in auth context')
    const result = await this.testJourney.simulateReply(tenantId, ticketId, body?.reply)
    return { ok: true, result, message: `Reply injected → ${result}. Click "Wake Agents" to let the agent respond.` }
  }

  /** Force-complete a stage and trigger pipeline advance */
  @Post('test-journey/advance/:ticketId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[DEV] Force-complete a stage and trigger pipeline advance' })
  async forceAdvance(@Request() req: any, @Param('ticketId') ticketId: string) {
    const tenantId: string = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('No tenant in auth context')
    const result = await this.testJourney.forceAdvance(tenantId, ticketId)

    if (result.completingAgentId) {
      const ticket = await this.prisma.activityTicket.findUnique({
        where: { id: ticketId },
        include: { assignedAgent: true },
      }).catch(() => null)
      if (ticket) {
        this.chat.pipelineAdvance(tenantId, ticket as any, ticket.assignedAgent as any, result.note).catch(() => {})
      }
    }

    return {
      ok: true,
      ...result,
      message: `Stage ${result.stageIdx + 1} force-completed. Pipeline advance triggered — next stage ticket will appear shortly.`,
    }
  }
}
