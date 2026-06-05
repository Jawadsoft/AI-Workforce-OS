import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { WebhooksService, CRMWebhookPayload } from './webhooks.service'

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  // ── Public webhook endpoint — called by external CRM ─────────────
  // URL format: POST /webhooks/crm/:tenantId/:event
  // CRM must be configured to POST to this URL

  @Post('crm/:tenantId/:event')
  @ApiOperation({ summary: 'Receive a CRM webhook event and auto-trigger the matching agent' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID (configure in CRM webhook URL)' })
  @ApiParam({ name: 'event', description: 'Event name e.g. lead.created, job.created' })
  async receiveCRMWebhook(
    @Param('tenantId') tenantId: string,
    @Param('event') event: string,
    @Body() body: Record<string, any>,
  ) {
    const payload: CRMWebhookPayload = {
      event,
      tenantId,
      data: body,
    }
    return this.service.handleCRMEvent(tenantId, payload)
  }

  // ── Auth-guarded endpoint — tenant posts their own event ──────────

  @Post('trigger')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Manually trigger a CRM webhook event (for testing)' })
  async triggerEvent(
    @CurrentTenant() tenantId: string,
    @Body() payload: CRMWebhookPayload,
  ) {
    return this.service.handleCRMEvent(tenantId, payload)
  }

  // ── List recent webhook-triggered conversations ───────────────────

  @Get('conversations')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List conversations triggered by webhook events' })
  async listWebhookConversations(@CurrentTenant() tenantId: string) {
    return this.service.listWebhookConversations(tenantId)
  }
}
