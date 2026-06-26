import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, Req,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsBoolean, IsArray, IsEmail } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { SuperAdminGuard } from '../../common/guards/super-admin.guard'
import { SuperAdminService } from './super-admin.service'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { ALL_FEATURES } from '../../common/feature-flags/feature-flags.constants'

class CreateTemplateDto {
  @IsString() name: string
  @IsString() role: string
  @IsString() description: string
  @IsArray() industries: string[]
  @IsString() defaultPrompt: string
  @IsArray() tools: string[]
  @IsOptional() @IsString() avatar?: string
  @IsOptional() @IsBoolean() isPublic?: boolean
}

class UpdateTemplateDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() role?: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsArray() industries?: string[]
  @IsOptional() @IsString() defaultPrompt?: string
  @IsOptional() @IsArray() tools?: string[]
  @IsOptional() @IsString() avatar?: string
  @IsOptional() @IsBoolean() isPublic?: boolean
}

class UpdateTenantConfigDto {
  @IsOptional() @IsString() industry?: string
  @IsOptional() @IsString() crmProvider?: string
  @IsOptional() @IsString() crmName?: string
  @IsOptional() @IsString() crmBaseUrl?: string
  @IsOptional() @IsString() crmApiKey?: string
}

class CreateSuperAdminDto {
  @IsEmail() email: string
  @IsString() password: string
  @IsString() name: string
}

class SetFeatureFlagDto {
  @IsString() feature: string
  @IsBoolean() enabled: boolean
  @IsOptional() @IsString() notes?: string
}

class BulkFeatureFlagDto {
  @IsArray() features: string[]
  @IsBoolean() enabled: boolean
}

// ── Protected routes (require SUPER_ADMIN role) ───────────────────

@ApiTags('Super Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('super-admin')
export class SuperAdminController {
  constructor(
    private readonly service: SuperAdminService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get platform-wide stats' })
  getStats() {
    return this.service.getStats()
  }

  @Get('tenants')
  @ApiOperation({ summary: 'List all tenants' })
  listTenants() {
    return this.service.listTenants()
  }

  @Get('tenants/pending')
  @ApiOperation({ summary: 'List tenants awaiting approval' })
  listPendingTenants() {
    return this.service.listPendingTenants()
  }

  @Post('tenants/:id/approve')
  @ApiOperation({ summary: 'Approve a pending tenant signup' })
  approveTenant(@Param('id') id: string) {
    return this.service.approveTenant(id)
  }

  @Post('tenants/:id/reject')
  @ApiOperation({ summary: 'Reject and delete a pending tenant signup' })
  rejectTenant(@Param('id') id: string) {
    return this.service.rejectTenant(id)
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Get tenant detail' })
  getTenant(@Param('id') id: string) {
    return this.service.getTenant(id)
  }

  @Patch('tenants/:id/config')
  @ApiOperation({ summary: 'Update tenant industry and CRM config' })
  updateTenantConfig(@Param('id') id: string, @Body() dto: UpdateTenantConfigDto) {
    return this.service.updateTenantConfig(id, dto)
  }

  @Post('tenants/:id/suspend')
  @ApiOperation({ summary: 'Suspend a tenant' })
  suspendTenant(@Param('id') id: string) {
    return this.service.suspendTenant(id)
  }

  @Post('tenants/:id/activate')
  @ApiOperation({ summary: 'Activate a suspended tenant' })
  activateTenant(@Param('id') id: string) {
    return this.service.activateTenant(id)
  }

  @Delete('tenants/:id')
  @ApiOperation({ summary: 'Permanently delete a tenant' })
  deleteTenant(@Param('id') id: string) {
    return this.service.deleteTenant(id)
  }

  @Get('templates')
  @ApiOperation({ summary: 'List all agent templates (public + private)' })
  listTemplates() {
    return this.service.listTemplates()
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create a new agent template' })
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.service.createTemplate(dto)
  }

  @Patch('templates/:id')
  @ApiOperation({ summary: 'Update an agent template' })
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.service.updateTemplate(id, dto)
  }

  @Post('templates/:id/toggle-visibility')
  @ApiOperation({ summary: 'Toggle template public/private visibility' })
  toggleVisibility(@Param('id') id: string) {
    return this.service.toggleTemplateVisibility(id)
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Delete an agent template' })
  deleteTemplate(@Param('id') id: string) {
    return this.service.deleteTemplate(id)
  }

  @Post('create-admin')
  @ApiOperation({ summary: 'Create a new super admin user' })
  createSuperAdmin(@Body() dto: CreateSuperAdminDto) {
    return this.service.createSuperAdmin(dto)
  }

  // ── Feature Flags ─────────────────────────────────────────────────

  @Get('features')
  @ApiOperation({ summary: 'List all available feature keys' })
  listFeatureKeys() {
    return { features: ALL_FEATURES }
  }

  @Get('tenants/:id/features')
  @ApiOperation({ summary: 'Get all feature flags for a tenant' })
  getTenantFeatures(@Param('id') id: string) {
    return this.featureFlags.getAllFlagsForTenant(id)
  }

  @Post('tenants/:id/features')
  @ApiOperation({ summary: 'Enable or disable a feature for a tenant' })
  setFeature(@Param('id') id: string, @Body() dto: SetFeatureFlagDto, @Req() req: any) {
    return this.featureFlags.setFeature(id, dto.feature, dto.enabled, req.user?.id, dto.notes)
  }

  @Post('tenants/:id/features/bulk')
  @ApiOperation({ summary: 'Bulk enable or disable multiple features for a tenant' })
  bulkSetFeatures(@Param('id') id: string, @Body() dto: BulkFeatureFlagDto, @Req() req: any) {
    return this.featureFlags.setManyFeatures(id, dto.features, dto.enabled, req.user?.id)
  }
}

// ── Public bootstrap endpoint (no auth required) ─────────────────

@ApiTags('Super Admin')
@Controller('super-admin')
export class SuperAdminBootstrapController {
  constructor(private readonly service: SuperAdminService) {}

  @Post('bootstrap')
  @ApiOperation({ summary: 'Create the first super admin (one-time setup)' })
  bootstrap(@Body() dto: CreateSuperAdminDto) {
    return this.service.createSuperAdmin(dto)
  }
}
