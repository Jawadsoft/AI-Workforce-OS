import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards, BadRequestException } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsEmail, IsIn } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentTenant, CurrentUser } from '../../common/decorators/tenant.decorator'
import { TenantsService } from './tenants.service'
import { EmailService } from '../email/email.service'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { FEATURES } from '../../common/feature-flags/feature-flags.constants'
import { AutonomyService } from '../../common/autonomy/autonomy.service'
import { isAutonomyMode, AUTONOMY_MODES } from '../../common/autonomy/autonomy.constants'

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

class InviteMemberDto {
  @IsString() name: string
  @IsEmail() email: string
  @IsIn(['TENANT_ADMIN', 'MANAGER', 'USER', 'VIEWER'])
  role: string
  @IsOptional() @IsString() designation?: string
  @IsOptional() @IsString() department?: string
  @IsOptional() @IsString() phone?: string
}

class UpdateMemberProfileDto {
  @IsOptional() @IsString() designation?: string
  @IsOptional() @IsString() department?: string
  @IsOptional() @IsString() phone?: string
}

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly service: TenantsService,
    private readonly email: EmailService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly autonomy: AutonomyService,
  ) {}

  @Get('features')
  @ApiOperation({ summary: 'Get enabled features for this tenant' })
  async getFeatures(@CurrentTenant() tenantId: string) {
    const features = await this.featureFlags.getEnabledFeatures(tenantId)
    return { features }
  }

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

  @Patch('settings')
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Update tenant settings (deep-merges nested objects like widget, brain)' })
  updateSettings(@CurrentTenant() tenantId: string, @Body() dto: Record<string, any>) {
    return this.service.saveSettings(tenantId, dto)
  }

  @Get('autonomy')
  @ApiOperation({ summary: 'Get AI workforce autonomy / emergency-stop mode for this tenant' })
  getAutonomy(@CurrentTenant() tenantId: string) {
    return this.autonomy.getState(tenantId)
  }

  @Patch('autonomy')
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Set AI workforce autonomy mode (off | internal | full)' })
  setAutonomy(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: { mode?: string; reason?: string },
  ) {
    if (!isAutonomyMode(dto.mode)) {
      throw new BadRequestException(`mode must be one of: ${AUTONOMY_MODES.join(', ')}`)
    }
    return this.autonomy.setMode(tenantId, dto.mode, {
      id: user?.id,
      name: user?.name ?? user?.email ?? user?.id,
    }, dto.reason)
  }

  @Get('onboarding-status')
  @ApiOperation({ summary: 'Check if onboarding is complete' })
  async onboardingStatus(@CurrentTenant() tenantId: string) {
    const complete = await this.service.isOnboardingComplete(tenantId)
    return { complete }
  }

  @Post('reset-workforce')
  @ApiOperation({ summary: 'Deactivate all agents and regenerate from industry templates' })
  async resetWorkforce(@CurrentTenant() tenantId: string, @Body() dto: GenerateWorkforceDto) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.RESET_WORKFORCE)
    return this.service.resetAndRegenerateWorkforce(tenantId, dto.industry)
  }

  // ── Team Management ───────────────────────────────────────────────

  @Get('team')
  @ApiOperation({ summary: 'List all team members' })
  getTeam(@CurrentTenant() tenantId: string) {
    return this.service.getTeamMembers(tenantId)
  }

  @Post('team/invite')
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Invite a new team member' })
  inviteMember(@CurrentTenant() tenantId: string, @Body() dto: InviteMemberDto) {
    return this.service.inviteMember(tenantId, dto)
  }

  @Patch('team/:id/role')
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Change a member role' })
  updateRole(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: { role: string }) {
    return this.service.updateMemberRole(tenantId, id, dto.role)
  }

  @Patch('team/:id/profile')
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Update member designation, department, and phone' })
  updateProfile(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateMemberProfileDto) {
    return this.service.updateMemberProfile(tenantId, id, dto)
  }

  @Delete('team/:id')
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Remove a team member' })
  removeMember(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: any) {
    return this.service.removeMember(tenantId, id, user.id)
  }

  // ── Email / SMTP Settings ─────────────────────────────────────────

  @Get('email-settings')
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN')
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
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Save tenant SMTP settings' })
  async saveEmailSettings(@CurrentTenant() tenantId: string, @Body() dto: Record<string, string>) {
    return this.service.saveSettings(tenantId, dto)
  }

  @Post('test-email')
  @UseGuards(RolesGuard)
  @Roles('TENANT_ADMIN')
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
