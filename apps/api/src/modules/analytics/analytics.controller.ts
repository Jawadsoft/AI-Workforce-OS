import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { AnalyticsService } from './analytics.service'

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Overview stats' })
  summary(@CurrentTenant() tenantId: string) {
    return this.service.getSummary(tenantId)
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Tasks over time (last N days)' })
  tasks(@CurrentTenant() tenantId: string, @Query('days') days?: string) {
    return this.service.getTasksOverTime(tenantId, Number(days ?? 14))
  }

  @Get('agents')
  @ApiOperation({ summary: 'Per-agent task and conversation breakdown' })
  agents(@CurrentTenant() tenantId: string) {
    return this.service.getAgentBreakdown(tenantId)
  }

  @Get('approvals')
  @ApiOperation({ summary: 'Approval stats by status and type' })
  approvals(@CurrentTenant() tenantId: string) {
    return this.service.getApprovalStats(tenantId)
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Conversation volume over time' })
  conversations(@CurrentTenant() tenantId: string, @Query('days') days?: string) {
    return this.service.getConversationVolume(tenantId, Number(days ?? 14))
  }
}
