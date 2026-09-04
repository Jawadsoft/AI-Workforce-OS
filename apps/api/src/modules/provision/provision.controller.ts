import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  BadRequestException,
  Res,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Response } from 'express'
import { SuperAdminService } from '../super-admin/super-admin.service'

@ApiTags('Provision')
@Controller('provision')
export class ProvisionController {
  constructor(private readonly service: SuperAdminService) {}

  /**
   * Public endpoint — no JWT required.
   * Called by StormBuddi CRM (or any external system) to create a new tenant
   * and automatically assign it under the scoped admin that owns the provision key.
   *
   * Headers:
   *   x-provision-key: pk_live_<hex>
   *
   * Body:
   *   {
   *     companyName: string        // Tenant display name
   *     slug?: string              // URL slug (auto-generated if omitted)
   *     ownerName: string          // Full name of the tenant owner
   *     ownerEmail: string         // Email — receives the verification link
   *     industry?: string          // e.g. "ROOFING"
   *     phone?: string             // Optional
   *     websiteUrl?: string        // Optional — triggers auto brain enrichment
   *   }
   *
   * Response includes:
   *   tenant: { id, name, slug }
   *   owner: { id, email, name }
   *   clonedAgents: number
   *   verificationLink: string
   *   brainEnrichQueued: boolean
   */
  @Post('tenant')
  @ApiOperation({ summary: 'Provision a new tenant using a scoped admin provision key' })
  provisionTenant(
    @Headers('x-provision-key') provisionKey: string,
    @Body()
    body: {
      companyName: string
      slug?: string
      ownerName: string
      ownerEmail: string
      industry?: string
      phone?: string
      websiteUrl?: string
    },
  ) {
    if (!provisionKey) {
      throw new BadRequestException('Missing x-provision-key header')
    }
    if (!body.companyName || !body.ownerName || !body.ownerEmail) {
      throw new BadRequestException('companyName, ownerName, and ownerEmail are required')
    }
    return this.service.provisionTenantByKey(provisionKey, body)
  }

  /**
   * One-click approve/reject link — no JWT required.
   * Sent to the scoped admin via email after a new tenant is provisioned.
   *
   * Query:
   *   token  — approvalToken stored on the Tenant row
   *   action — "approve" | "reject"
   */
  @Get('approve')
  @ApiOperation({ summary: 'One-click tenant approve/reject from email link' })
  async handleApproval(
    @Query('token') token: string,
    @Query('action') action: string,
    @Res() res: Response,
  ) {
    if (!token || !['approve', 'reject'].includes(action)) {
      return res.status(400).send(this.htmlPage('Invalid Link', '⚠️ This link is invalid or missing required parameters.', '#dc2626'))
    }
    try {
      const result = await this.service.handleApprovalToken(token, action as 'approve' | 'reject')
      if (action === 'approve') {
        return res.send(this.htmlPage(
          'Client Approved ✅',
          `<strong>${result.tenantName}</strong> has been approved and activated. The owner will be notified.`,
          '#16a34a',
        ))
      } else {
        return res.send(this.htmlPage(
          'Client Rejected',
          `The signup for <strong>${result.tenantName}</strong> has been rejected and removed.`,
          '#dc2626',
        ))
      }
    } catch (err: any) {
      return res.status(400).send(this.htmlPage(
        'Link Expired or Already Used',
        err.message || 'This approval link has already been used or has expired.',
        '#f59e0b',
      ))
    }
  }

  private htmlPage(title: string, message: string, color: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="max-width:480px;margin:0 auto;padding:48px 24px;text-align:center;">
    <div style="font-size:64px;margin-bottom:16px;">${color === '#16a34a' ? '✅' : color === '#dc2626' ? '❌' : '⚠️'}</div>
    <h1 style="color:#f1f5f9;font-size:24px;margin:0 0 12px;">${title}</h1>
    <p style="color:#94a3b8;font-size:15px;line-height:1.6;">${message}</p>
    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/super-admin/dashboard"
       style="display:inline-block;margin-top:32px;padding:12px 28px;background:${color};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      Go to Dashboard
    </a>
  </div>
</body>
</html>`
  }
}
