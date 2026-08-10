import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, Req, Query, UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsString, IsOptional, IsBoolean, IsArray, IsEmail, IsInt } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { SuperAdminGuard } from '../../common/guards/super-admin.guard'
import { SuperAdminService } from './super-admin.service'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { ALL_FEATURES } from '../../common/feature-flags/feature-flags.constants'
import { IndustryKnowledgeService } from '../knowledge/industry-knowledge.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { HelpService } from '../help/help.service'

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

class CreateTenantDto {
  @IsString() name: string
  @IsString() slug: string
  @IsString() ownerName: string
  @IsEmail() ownerEmail: string
  @IsOptional() @IsString() industry?: string
}

class CreateScopedAdminDto {
  @IsEmail() email: string
  @IsString() password: string
  @IsString() name: string
  @IsOptional() @IsInt() maxTenants?: number
  @IsOptional() @IsArray() permissions?: string[]
}

class UpdateScopedAdminLimitsDto {
  @IsOptional() @IsInt() maxTenants?: number
  @IsOptional() @IsArray() permissions?: string[]
}

class CreateTemplateWorkspaceAgentDto {
  @IsOptional() @IsString() adminId?: string
  @IsString() name: string
  @IsString() role: string
  @IsOptional() @IsString() industry?: string
  @IsString() prompt: string
  @IsOptional() @IsArray() tools?: string[]
  @IsOptional() @IsArray() permissions?: string[]
  @IsOptional() @IsBoolean() isSharedDefault?: boolean
}

class InstallTemplateWorkspaceAgentDto {
  @IsOptional() @IsString() adminId?: string
  @IsString() templateId: string
  @IsOptional() @IsBoolean() isSharedDefault?: boolean
}

class UpdateTemplateWorkspaceAgentDto {
  @IsOptional() @IsString() adminId?: string
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() role?: string
  @IsOptional() @IsString() prompt?: string
  @IsOptional() @IsArray() tools?: string[]
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsBoolean() isSharedDefault?: boolean
}

class ResetTemplateWorkspaceDto {
  @IsOptional() @IsString() adminId?: string
  @IsOptional() @IsBoolean() clearAgents?: boolean
}

class AssignTenantDto {
  @IsString() adminUserId: string
  @IsString() tenantId: string
}

class RevokeTenantDto {
  @IsString() adminUserId: string
  @IsString() tenantId: string
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

class UpsertPackDto {
  @IsString() industry: string
  @IsString() name: string
  @IsOptional() @IsString() description?: string
}

class AddDocDto {
  @IsString() packId: string
  @IsString() name: string
  @IsString() category: string
  @IsArray() agentRoles: string[]
  @IsString() content: string
}

class UpsertHelpOverrideDto {
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() category?: string
  @IsOptional() @IsString() audience?: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsArray() steps?: string[]
  @IsOptional() @IsArray() tips?: string[]
  @IsOptional() @IsBoolean() isCustom?: boolean
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
    private readonly industryKnowledge: IndustryKnowledgeService,
    private readonly knowledge: KnowledgeService,
    private readonly help: HelpService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get platform-wide stats' })
  getStats(@Req() req: any) {
    return this.service.getStats(req.user?.allowedTenantIds)
  }

  @Get('tenants')
  @ApiOperation({ summary: 'List all tenants' })
  listTenants(@Req() req: any) {
    return this.service.listTenants(req.user?.allowedTenantIds)
  }

  @Get('tenants/pending')
  @ApiOperation({ summary: 'List tenants awaiting approval' })
  listPendingTenants(@Req() req: any) {
    return this.service.listPendingTenants(req.user?.allowedTenantIds)
  }

  @Post('tenants/:id/approve')
  @ApiOperation({ summary: 'Approve a pending tenant signup' })
  approveTenant(@Param('id') id: string, @Req() req: any) {
    return this.service.approveTenant(id, req.user?.allowedTenantIds)
  }

  @Post('tenants/:id/reject')
  @ApiOperation({ summary: 'Reject and delete a pending tenant signup' })
  rejectTenant(@Param('id') id: string, @Req() req: any) {
    return this.service.rejectTenant(id, req.user?.allowedTenantIds)
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Get tenant detail' })
  getTenant(@Param('id') id: string, @Req() req: any) {
    return this.service.getTenant(id, req.user?.allowedTenantIds)
  }

  @Patch('tenants/:id/config')
  @ApiOperation({ summary: 'Update tenant industry and CRM config' })
  updateTenantConfig(@Param('id') id: string, @Body() dto: UpdateTenantConfigDto, @Req() req: any) {
    return this.service.updateTenantConfig(id, dto, req.user?.allowedTenantIds)
  }

  @Post('tenants/:id/suspend')
  @ApiOperation({ summary: 'Suspend a tenant' })
  suspendTenant(@Param('id') id: string, @Req() req: any) {
    return this.service.suspendTenant(id, req.user?.allowedTenantIds)
  }

  @Post('tenants/:id/activate')
  @ApiOperation({ summary: 'Activate a suspended tenant' })
  activateTenant(@Param('id') id: string, @Req() req: any) {
    return this.service.activateTenant(id, req.user?.allowedTenantIds)
  }

  @Delete('tenants/:id')
  @ApiOperation({ summary: 'Permanently delete a tenant' })
  deleteTenant(@Param('id') id: string, @Req() req: any) {
    return this.service.deleteTenant(id, req.user?.allowedTenantIds)
  }

  @Post('tenants/create')
  @ApiOperation({ summary: 'Create a new tenant (requires email verification)' })
  createTenant(@Body() dto: CreateTenantDto, @Req() req: any) {
    return this.service.createTenantWithVerification(dto, req.user.id, req.user.role)
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

  // ── Scoped Admin Management ───────────────────────────────────────

  @Post('scoped-admins')
  @ApiOperation({ summary: 'Create a new scoped admin (limited to specific tenants)' })
  createScopedAdmin(@Body() dto: CreateScopedAdminDto, @Req() req: any) {
    return this.service.createScopedAdmin({ ...dto, createdByAdminId: req.user.id })
  }

  @Get('scoped-admins')
  @ApiOperation({ summary: 'List all scoped admins created by the current root admin' })
  listSubAdmins(@Req() req: any) {
    return this.service.listSubAdmins(req.user.id)
  }

  @Post('scoped-admins/assign')
  @ApiOperation({ summary: 'Assign a tenant to a scoped admin' })
  assignTenant(@Body() dto: AssignTenantDto, @Req() req: any) {
    return this.service.assignTenant(dto.adminUserId, dto.tenantId, req.user.id)
  }

  @Delete('scoped-admins/revoke')
  @ApiOperation({ summary: 'Revoke tenant access from a scoped admin' })
  revokeTenant(@Body() dto: RevokeTenantDto) {
    return this.service.revokeTenant(dto.adminUserId, dto.tenantId)
  }

  @Delete('scoped-admins/:id')
  @ApiOperation({ summary: 'Delete a scoped admin (also revokes all their tenant assignments)' })
  deleteScopedAdmin(@Param('id') id: string) {
    return this.service.deleteScopedAdmin(id)
  }

  @Patch('scoped-admins/:id/limits')
  @ApiOperation({ summary: 'Update tenant limit and permissions for a scoped admin' })
  updateScopedAdminLimits(@Param('id') id: string, @Body() dto: UpdateScopedAdminLimitsDto) {
    return this.service.updateScopedAdminLimits(id, dto)
  }

  // ── Scoped Admin Default Workspace (template agents) ──────────────

  @Post('template-workspace/reset')
  @ApiOperation({ summary: 'Create default workspace if missing; optionally clear agents' })
  resetTemplateWorkspace(@Body() dto: ResetTemplateWorkspaceDto, @Req() req: any) {
    return this.service.resetTemplateWorkspace(
      { id: req.user.id, role: req.user.role },
      dto,
    )
  }

  @Post('template-workspace/push-defaults')
  @ApiOperation({ summary: 'Push shared default agents to all tenants assigned to this scoped admin' })
  pushDefaultsToAssignedTenants(@Body() dto: ResetTemplateWorkspaceDto, @Req() req: any) {
    return this.service.pushDefaultsToAssignedTenants(
      { id: req.user.id, role: req.user.role },
      dto.adminId,
    )
  }

  @Get('template-workspace/agents')
  @ApiOperation({ summary: 'List agents in a scoped admin default workspace' })
  listTemplateWorkspaceAgents(@Req() req: any, @Query('adminId') adminId?: string) {
    return this.service.listTemplateWorkspaceAgents(
      { id: req.user.id, role: req.user.role },
      adminId,
    )
  }

  @Post('template-workspace/agents')
  @ApiOperation({ summary: 'Create an agent on the scoped admin default workspace' })
  createTemplateWorkspaceAgent(@Body() dto: CreateTemplateWorkspaceAgentDto, @Req() req: any) {
    return this.service.createTemplateWorkspaceAgent(
      { id: req.user.id, role: req.user.role },
      dto,
    )
  }

  @Post('template-workspace/agents/install-template')
  @ApiOperation({ summary: 'Install a marketplace template into the default workspace' })
  installTemplateWorkspaceAgent(@Body() dto: InstallTemplateWorkspaceAgentDto, @Req() req: any) {
    return this.service.installTemplateToWorkspace(
      { id: req.user.id, role: req.user.role },
      dto,
    )
  }

  @Patch('template-workspace/agents/:id')
  @ApiOperation({ summary: 'Update a default-workspace agent (including share toggle)' })
  updateTemplateWorkspaceAgent(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateWorkspaceAgentDto,
    @Req() req: any,
  ) {
    return this.service.updateTemplateWorkspaceAgent(
      { id: req.user.id, role: req.user.role },
      id,
      dto,
    )
  }

  @Delete('template-workspace/agents/:id')
  @ApiOperation({ summary: 'Remove an agent from the default workspace' })
  deleteTemplateWorkspaceAgent(
    @Param('id') id: string,
    @Req() req: any,
    @Query('adminId') adminId?: string,
  ) {
    return this.service.deleteTemplateWorkspaceAgent(
      { id: req.user.id, role: req.user.role },
      id,
      adminId,
    )
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

  // ── Industry Knowledge ───────────────────────────────────────────

  @Get('industry-knowledge')
  @ApiOperation({ summary: 'List all industry knowledge packs' })
  listPacks() {
    return this.industryKnowledge.findAllPacks()
  }

  @Get('industry-knowledge/:industry/docs')
  @ApiOperation({ summary: 'Get all documents for an industry pack' })
  getPackDocs(@Param('industry') industry: string) {
    return this.industryKnowledge.findPackByIndustry(industry)
  }

  @Post('industry-knowledge/pack')
  @ApiOperation({ summary: 'Create or update an industry knowledge pack' })
  upsertPack(@Body() dto: UpsertPackDto) {
    return this.industryKnowledge.upsertPack(dto.industry, dto.name, dto.description)
  }

  @Post('industry-knowledge/doc')
  @ApiOperation({ summary: 'Add a document to an industry pack' })
  addDoc(@Body() dto: AddDocDto) {
    return this.industryKnowledge.addDocument(dto.packId, dto)
  }

  @Post('industry-knowledge/doc/upload')
  @ApiOperation({ summary: 'Upload a PDF/DOCX file as an industry knowledge document' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async uploadDoc(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { packId: string; name?: string; category?: string; agentRoles?: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded')
    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase()
    const text = await this.knowledge.extractTextFromBuffer(file.buffer, file.mimetype, file.originalname)
    if (!text || text.trim().length < 50) throw new BadRequestException('Could not extract text from file. Use a text-based PDF or DOCX.')
    const roles = body.agentRoles ? body.agentRoles.split(',').map(r => r.trim()).filter(Boolean) : []
    const name = body.name || file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
    return this.industryKnowledge.addDocument(body.packId, {
      name,
      category: body.category ?? 'general',
      agentRoles: roles,
      content: text,
    })
  }

  @Get('industry-knowledge/doc/:id')
  @ApiOperation({ summary: 'Get a single industry knowledge document with full content' })
  getDoc(@Param('id') id: string) {
    return this.industryKnowledge.getDocument(id)
  }

  @Delete('industry-knowledge/doc/:id')
  @ApiOperation({ summary: 'Delete an industry knowledge document' })
  deleteDoc(@Param('id') id: string) {
    return this.industryKnowledge.deleteDocument(id)
  }

  @Post('industry-knowledge/:industry/embed-all')
  @ApiOperation({ summary: 'Re-embed all documents in an industry pack' })
  embedAll(@Param('industry') industry: string) {
    return this.industryKnowledge.embedAllInPack(industry)
  }

  // ── Help Guide content (overrides + images on top of static articles) ──

  @Get('help/articles')
  @ApiOperation({ summary: 'List all Help Guide overrides and their attached images' })
  async listHelpArticles() {
    return this.help.getMergedContent()
  }

  @Post('help/articles/:articleId')
  @ApiOperation({ summary: 'Create or update a Help Guide article override (or a brand new custom article)' })
  upsertHelpOverride(@Param('articleId') articleId: string, @Body() dto: UpsertHelpOverrideDto, @Req() req: any) {
    return this.help.upsertOverride(articleId, dto, req.user?.id)
  }

  @Delete('help/articles/:articleId')
  @ApiOperation({ summary: 'Revert an article override back to its static default (deletes custom articles entirely)' })
  resetHelpOverride(@Param('articleId') articleId: string) {
    return this.help.resetOverride(articleId)
  }

  @Post('help/articles/:articleId/images')
  @ApiOperation({ summary: 'Attach an image (e.g. a CRM screenshot) to a Help Guide article' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async addHelpImage(
    @Param('articleId') articleId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { caption?: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded')
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('File must be an image')
    return this.help.addImage(articleId, file, body?.caption)
  }

  @Delete('help/images/:imageId')
  @ApiOperation({ summary: 'Remove an image from a Help Guide article' })
  deleteHelpImage(@Param('imageId') imageId: string) {
    return this.help.deleteImage(imageId)
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
