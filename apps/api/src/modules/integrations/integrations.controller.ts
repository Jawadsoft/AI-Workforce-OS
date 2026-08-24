import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  Patch,
} from '@nestjs/common'
import type { Response } from 'express'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { IntegrationsService } from './integrations.service'
import { IsString, IsOptional, IsBoolean, IsInt, Min, Max, IsIn } from 'class-validator'
import { Transform, Type } from 'class-transformer'

class ConnectImapDto {
  @IsString()
  accountEmail: string

  @IsOptional()
  @IsString()
  accountName?: string

  // ── IMAP (incoming) ──
  @IsString()
  imapHost: string

  @Type(() => Number)
  @IsInt()
  imapPort: number

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  imapSecure: boolean

  @IsString()
  password: string

  // ── SMTP (outgoing) ──
  @IsOptional()
  @IsString()
  smtpHost?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  smtpPort?: number

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  smtpSecure?: boolean

  @IsOptional()
  @IsString()
  smtpUser?: string

  @IsOptional()
  @IsString()
  smtpPassword?: string

  @IsOptional()
  @IsString()
  smtpFromName?: string
}

class TestImapDto {
  @IsString()
  imapHost: string

  @Type(() => Number)
  @IsInt()
  imapPort: number

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  imapSecure: boolean

  @IsString()
  accountEmail: string

  @IsString()
  password: string
}

class ReplyProcessedEmailDto {
  @IsString()
  body: string
}

class UpdateProcessedEmailDto {
  @IsOptional()
  @IsIn(['pending', 'actioned', 'skipped', 'failed'])
  status?: string

  @IsOptional()
  @IsString()
  action?: string
}

class UpdateConnectedAccountDto {
  @IsOptional()
  @IsString()
  assignedAgentId?: string | null
}

class UpdateEmailRuleDto {
  @IsOptional()
  @IsIn(['auto_reply', 'auto_draft', 'approval_required', 'notify_only', 'block'])
  mode?: string

  @IsOptional()
  @IsString()
  replyTemplate?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  confidenceThreshold?: number

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @IsString()
  assignedAgentId?: string | null
}

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  // ── Connected Accounts ───────────────────────────────────────────────

  @Get('accounts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List connected accounts (Google, Microsoft)' })
  getAccounts(@CurrentTenant() tenantId: string) {
    return this.service.getConnectedAccounts(tenantId)
  }

  @Patch('accounts/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a connected account (e.g. assign agent)' })
  updateAccount(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConnectedAccountDto,
  ) {
    return this.service.updateConnectedAccount(tenantId, id, dto)
  }

  @Delete('accounts/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect a connected account (Google, Microsoft, or IMAP)' })
  @HttpCode(204)
  disconnect(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.disconnectGoogleAccount(tenantId, id)
  }

  // ── Google OAuth ─────────────────────────────────────────────────────

  @Get('google/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Redirect to Google OAuth consent screen' })
  connectGoogle(@CurrentTenant() tenantId: string, @Res() res: Response) {
    const url = this.service.getGoogleAuthUrl(tenantId)
    res.redirect(url)
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback — exchanges code for tokens' })
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      await this.service.handleGoogleCallback(code, state)
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
      res.redirect(`${frontendUrl}/settings?tab=integrations&connected=google`)
    } catch (err: any) {
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
      res.redirect(`${frontendUrl}/settings?tab=integrations&error=${encodeURIComponent(err.message)}`)
    }
  }

  // ── Microsoft / Office 365 OAuth ─────────────────────────────────────

  @Get('microsoft/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Redirect to Microsoft OAuth consent screen' })
  connectMicrosoft(@CurrentTenant() tenantId: string, @Res() res: Response) {
    const url = this.service.getMicrosoftAuthUrl(tenantId)
    res.redirect(url)
  }

  @Get('microsoft/callback')
  @ApiOperation({ summary: 'Microsoft OAuth callback — exchanges code for tokens' })
  async microsoftCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      await this.service.handleMicrosoftCallback(code, state)
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
      res.redirect(`${frontendUrl}/settings?tab=integrations&connected=microsoft`)
    } catch (err: any) {
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
      res.redirect(`${frontendUrl}/settings?tab=integrations&error=${encodeURIComponent(err.message)}`)
    }
  }

  // ── IMAP ─────────────────────────────────────────────────────────────

  @Post('imap/test')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Test IMAP connection before saving' })
  @HttpCode(200)
  async testImap(@Body() dto: TestImapDto) {
    const imap = await this.service.testImapConnection({
      host: dto.imapHost,
      port: dto.imapPort,
      secure: dto.imapSecure,
      user: dto.accountEmail,
      password: dto.password,
    })
    return imap
  }

  @Post('imap/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Connect an email account via IMAP (any provider)' })
  @HttpCode(201)
  connectImap(@CurrentTenant() tenantId: string, @Body() dto: ConnectImapDto) {
    return this.service.connectImapAccount(tenantId, dto)
  }

  // ── Agents (for rule assignment dropdown) ───────────────────────────

  @Get('agents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active agents for email rule assignment' })
  getAgents(@CurrentTenant() tenantId: string) {
    return this.service.getAgentsForTenant(tenantId)
  }

  // ── Email Rules ──────────────────────────────────────────────────────

  @Get('email-rules')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all email agent rules for the tenant' })
  getEmailRules(@CurrentTenant() tenantId: string) {
    return this.service.getEmailRules(tenantId)
  }

  @Patch('email-rules/:emailType')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an email rule (mode, template, threshold)' })
  updateEmailRule(
    @CurrentTenant() tenantId: string,
    @Param('emailType') emailType: string,
    @Body() dto: UpdateEmailRuleDto,
  ) {
    return this.service.updateEmailRule(tenantId, emailType, dto)
  }

  // ── Email Scan (manual trigger) ──────────────────────────────────────

  @Post('email-scan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually trigger email scan for the tenant' })
  @HttpCode(200)
  async manualScan(@CurrentTenant() tenantId: string) {
    const result = await this.service.scanEmailsForTenant(tenantId)
    return { success: true, ...result }
  }

  // ── Processed Emails History ─────────────────────────────────────────

  @Get('emails')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get processed email history' })
  getEmails(
    @CurrentTenant() tenantId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('action') action?: string,
    @Query('status') status?: string,
    @Query('needsReview') needsReview?: string,
  ) {
    return this.service.getProcessedEmails(
      tenantId,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
      {
        action,
        status,
        needsReview: needsReview === 'true' || needsReview === '1',
      },
    )
  }

  @Post('emails/:id/reply')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send a reply to a processed email' })
  @HttpCode(200)
  replyToEmail(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ReplyProcessedEmailDto,
  ) {
    return this.service.replyToProcessedEmail(tenantId, id, dto.body)
  }

  @Patch('emails/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update processed email status (e.g. mark reviewed)' })
  updateEmailStatus(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProcessedEmailDto,
  ) {
    return this.service.updateProcessedEmailStatus(tenantId, id, dto)
  }
}
