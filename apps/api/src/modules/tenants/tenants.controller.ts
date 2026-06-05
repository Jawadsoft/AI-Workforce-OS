import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant, CurrentUser } from '../../common/decorators/tenant.decorator'
import { TenantsService } from './tenants.service'
import { EmailService } from '../email/email.service'

class OnboardDto {
  @IsString() industry: string
  @IsString() crm: string
  @IsString() services: string
  @IsOptional() @IsString() locations?: string
  @IsOptional() @IsString() businessRules?: string
  @IsOptional() @IsString() brandVoice?: string
}

class GenerateWorkforceDto {
  @IsString() industry: string
}

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly service: TenantsService,
    private readonly email: EmailService,
  ) {}

  @Patch('onboard')
  @ApiOperation({ summary: 'Save onboarding info for tenant' })
  onboard(@CurrentTenant() tenantId: string, @Body() dto: OnboardDto) {
    return this.service.onboard(tenantId, dto)
  }

  @Post('generate-workforce')
  @ApiOperation({ summary: 'Generate AI agents from industry templates' })
  generateWorkforce(@CurrentTenant() tenantId: string, @Body() dto: GenerateWorkforceDto) {
    return this.service.generateWorkforce(tenantId, dto.industry)
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get tenant settings' })
  getSettings(@CurrentTenant() tenantId: string) {
    return this.service.getSettings(tenantId)
  }

  @Get('onboarding-status')
  @ApiOperation({ summary: 'Check if onboarding is complete' })
  async onboardingStatus(@CurrentTenant() tenantId: string) {
    const complete = await this.service.isOnboardingComplete(tenantId)
    return { complete }
  }

  @Post('reset-workforce')
  @ApiOperation({ summary: 'Deactivate all agents and regenerate from industry templates' })
  resetWorkforce(@CurrentTenant() tenantId: string, @Body() dto: GenerateWorkforceDto) {
    return this.service.resetAndRegenerateWorkforce(tenantId, dto.industry)
  }

  // ── Team Management ───────────────────────────────────────────────

  @Get('team')
  @ApiOperation({ summary: 'List all team members' })
  getTeam(@CurrentTenant() tenantId: string) {
    return this.service.getTeamMembers(tenantId)
  }

  @Post('team/invite')
  @ApiOperation({ summary: 'Invite a new team member' })
  inviteMember(@CurrentTenant() tenantId: string, @Body() dto: { name: string; email: string; role: string }) {
    return this.service.inviteMember(tenantId, dto)
  }

  @Patch('team/:id/role')
  @ApiOperation({ summary: 'Change a member role' })
  updateRole(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: { role: string }) {
    return this.service.updateMemberRole(tenantId, id, dto.role)
  }

  @Delete('team/:id')
  @ApiOperation({ summary: 'Remove a team member' })
  removeMember(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: any) {
    return this.service.removeMember(tenantId, id, user.id)
  }

  // ── Email / SMTP Settings ─────────────────────────────────────────

  @Get('email-settings')
  @ApiOperation({ summary: 'Get tenant SMTP settings (masked)' })
  async getEmailSettings(@CurrentTenant() tenantId: string) {
    const cfg = await this.email.getSmtpConfig(tenantId)
    return {
      smtpHost: cfg.host,
      smtpPort: String(cfg.port),
      smtpSecure: String(cfg.secure),
      smtpUser: cfg.user,
      smtpPass: cfg.pass ? '***configured***' : '',
      smtpFromName: cfg.fromName,
      smtpFromEmail: cfg.fromEmail,
    }
  }

  @Put('email-settings')
  @ApiOperation({ summary: 'Save tenant SMTP settings' })
  async saveEmailSettings(@CurrentTenant() tenantId: string, @Body() dto: Record<string, string>) {
    return this.service.saveSettings(tenantId, dto)
  }

  @Post('test-email')
  @ApiOperation({ summary: 'Send a test email to verify SMTP config' })
  async testEmail(@CurrentTenant() tenantId: string, @Body() dto: { to?: string }) {
    const cfg = await this.email.getSmtpConfig(tenantId)
    const result = await this.email.testConnection(tenantId)
    if (result.success && dto.to) {
      await this.email.send({
        tenantId,
        to: dto.to || cfg.user,
        subject: 'AI Workforce OS — SMTP Test ✅',
        html: '<h2>It works! 🎉</h2><p>Your SMTP configuration is correctly set up for AI Workforce OS.</p>',
      })
    }
    return result
  }
}
