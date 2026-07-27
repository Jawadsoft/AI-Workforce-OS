import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger'
import { Response } from 'express'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { WebhooksService, CRMWebhookPayload } from './webhooks.service'

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  // ── Meta / Facebook webhook (Custom AI Agents, Page, Messenger) ──
  // Public URL to paste in Meta:
  //   https://<API_HOST>/api/v1/webhooks/meta
  // Set META_WEBHOOK_VERIFY_TOKEN in env to the same value you enter in Meta.

  @Get('meta')
  @ApiOperation({ summary: 'Meta webhook verification (hub.challenge handshake)' })
  verifyMetaWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const value = this.service.verifyMetaSubscription(mode, verifyToken, challenge)
    // Meta requires the challenge as raw plain text, not JSON
    return res.status(200).type('text/plain').send(value)
  }

  @Post('meta')
  @ApiOperation({ summary: 'Receive Meta / Facebook webhook events' })
  async receiveMetaWebhook(@Body() body: Record<string, any>) {
    // Acknowledge quickly so Meta does not retry. Signature verification can be
    // added later with express raw-body middleware if required by your Meta product.
    return this.service.handleMetaEvent(body ?? {})
  }

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
