import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Res } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsArray } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { AgentsService } from './agents.service'
import { ElevenLabsProvider } from '../../ai/providers/elevenlabs.provider'

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
  @IsOptional() approvalRules?: any
  @IsOptional() @IsArray() permissions?: string[]
}

class SpeakDto {
  @IsString() text: string
}

@ApiTags('Agents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly service: AgentsService,
    private readonly voice: ElevenLabsProvider,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all agents for tenant' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId)
  }

  @Get('templates')
  @ApiOperation({ summary: 'Get marketplace templates' })
  getTemplates() {
    return this.service.getTemplates()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single agent' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Create custom agent' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateAgentDto) {
    return this.service.create(tenantId, dto)
  }

  @Post('install-template/:templateId')
  @ApiOperation({ summary: 'Install agent from marketplace template' })
  installTemplate(@CurrentTenant() tenantId: string, @Param('templateId') templateId: string) {
    return this.service.installTemplate(tenantId, templateId)
  }

  @Patch(':id')
  @UseGuards(TenantAdminGuard)
  @ApiOperation({ summary: 'Update agent (Tenant Admin / Owner only)' })
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.service.update(tenantId, id, dto)
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate agent' })
  activate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.activate(tenantId, id)
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate agent' })
  deactivate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.deactivate(tenantId, id)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove agent' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id)
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
