import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger'
import { IsString, IsOptional, IsArray, IsBoolean } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { AgentsService } from './agents.service'
import { ElevenLabsProvider } from '../../ai/providers/elevenlabs.provider'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { FEATURES } from '../../common/feature-flags/feature-flags.constants'

class CreateAgentDto {
  @IsString() name: string
  @IsString() role: string
  @IsString() industry: string
  @IsString() prompt: string
  @IsOptional() @IsArray() tools?: string[]
  @IsOptional() @IsArray() permissions?: string[]
  @IsOptional() @IsString() avatar?: string
}

class UpdateAgentDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() role?: string
  @IsOptional() @IsString() prompt?: string
  @IsOptional() @IsArray() tools?: string[]
  @IsOptional() @IsArray() permissions?: string[]
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() avatar?: string
  @IsOptional() @IsString() voiceId?: string
  @IsOptional() approvalRules?: any
}

class SpeakDto {
  @IsString() text: string
}

class MergeAgentsDto {
  @IsString() primaryAgentId: string
  @IsOptional() @IsString() secondaryAgentId?: string
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() role?: string
  @IsOptional() @IsBoolean() setAsWhatsappAgent?: boolean
  @IsOptional() @IsBoolean() deactivateSources?: boolean
}

@ApiTags('Agents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly service: AgentsService,
    private readonly voice: ElevenLabsProvider,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all agents for tenant' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId)
  }

  @Get('templates')
  @ApiOperation({ summary: 'Get marketplace templates' })
  async getTemplates(@CurrentTenant() tenantId: string) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.MARKETPLACE)
    return this.service.getTemplates()
  }

  @Get('voices')
  @ApiOperation({ summary: 'List available ElevenLabs voices for agent voice selection' })
  getVoices() {
    return this.voice.getVoices()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single agent' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id)
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Create custom agent' })
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateAgentDto) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.CREATE_AGENTS)
    return this.service.create(tenantId, dto)
  }

  @Post('merge')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({
    summary: 'Create a new agent by merging one or two existing tenant agents (sources unchanged)',
  })
  async mergeAgents(@CurrentTenant() tenantId: string, @Body() dto: MergeAgentsDto) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.CREATE_AGENTS)
    return this.service.mergeAgents(tenantId, dto)
  }

  @Post('merge/rebuild')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Rewrite existing merged-agent prompts (skills, not second identity)' })
  async rebuildMergedPrompts(@CurrentTenant() tenantId: string) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.CREATE_AGENTS)
    return this.service.rebuildMergedPrompts(tenantId)
  }

  @Post('install-template/:templateId')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Install agent from marketplace template' })
  async installTemplate(@CurrentTenant() tenantId: string, @Param('templateId') templateId: string) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.MARKETPLACE)
    return this.service.installTemplate(tenantId, templateId)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Update agent (Manager / Admin / Owner)' })
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.service.update(tenantId, id, dto)
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Activate agent' })
  activate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.activate(tenantId, id)
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Deactivate agent' })
  deactivate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.deactivate(tenantId, id)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Permanently delete an agent (conversations move to another agent)' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id)
  }

  @Post(':id/avatar')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Upload agent avatar image' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) cb(new Error('Only image files are allowed') as any, false)
      else cb(null, true)
    },
  }))
  uploadAvatar(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadAvatar(tenantId, id, file)
  }

  @Get(':id/crm-access')
  @ApiOperation({ summary: 'Get agent CRM access permissions' })
  async getCRMAccess(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getCRMAccess(tenantId, id)
  }

  @Post(':id/speak')
  @ApiOperation({ summary: 'Generate voice audio for agent via ElevenLabs' })
  async speak(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SpeakDto,
    @Res() res: any,
  ) {
    const agent = await this.service.findOne(tenantId, id)
    const voiceId = this.voice.getAgentVoiceId(agent.name)
    const audio = await this.voice.textToSpeech(dto.text, voiceId)
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audio.length,
      'Cache-Control': 'no-cache',
    })
    res.end(audio)
  }
}
