import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant, CurrentUser } from '../../common/decorators/tenant.decorator'
import { ConferenceService } from './conference.service'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { FEATURES } from '../../common/feature-flags/feature-flags.constants'

class CreateConferenceDto {
  @IsOptional() @IsArray() @IsString({ each: true }) participantAgentIds?: string[]
  @IsOptional() @IsString() chairAgentId?: string
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() meetingType?: string
  @IsOptional() @IsString() agenda?: string
}

class UpdateParticipantsDto {
  @IsOptional() @IsArray() @IsString({ each: true }) participantAgentIds?: string[]
  @IsOptional() @IsString() chairAgentId?: string
  @IsOptional() @IsBoolean() listeningEnabled?: boolean
  @IsOptional() @IsString() meetingType?: string
  @IsOptional() @IsString() agenda?: string
  @IsOptional() @IsString() title?: string
}

class SubmitTurnDto {
  @IsString() text: string
  @IsString() clientTurnId: string
  @IsOptional() @IsString() manualAgentId?: string
}

class BargeInDto {
  @IsOptional() @IsString() turnId?: string
}

@ApiTags('Conference')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conference')
export class ConferenceController {
  constructor(
    private readonly service: ConferenceService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Get('agents')
  @ApiOperation({ summary: 'List ACTIVE agents available for a conference' })
  listAgents(@CurrentTenant() tenantId: string) {
    return this.service.listActiveAgents(tenantId)
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List past/open conference sessions (for reopen + memory)' })
  listSessions(
    @CurrentTenant() tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listSessions(tenantId, limit ? Number(limit) : 20)
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Create a conference session (default meetingType=MANAGEMENT)' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateConferenceDto,
  ) {
    await this.featureFlags.requireFeature(tenantId, FEATURES.CONFERENCE)
    return this.service.createSession(tenantId, user.id, dto)
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get conference session + transcript' })
  get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getSession(tenantId, id)
  }

  @Patch('sessions/:id/participants')
  @ApiOperation({ summary: 'Update participants / chair / agenda / meeting type' })
  updateParticipants(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateParticipantsDto,
  ) {
    return this.service.updateParticipants(tenantId, id, dto)
  }

  @Post('sessions/:id/close')
  @ApiOperation({ summary: 'End conference and save durable memory summary' })
  close(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.closeSession(tenantId, id)
  }

  @Post('sessions/:id/turns')
  @ApiOperation({ summary: 'Submit a conference turn (non-streaming)' })
  submitTurn(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SubmitTurnDto,
  ) {
    return this.service.submitTurn(tenantId, id, dto)
  }

  @Post('sessions/:id/turns/stream')
  @ApiOperation({
    summary:
      'Stream a conference turn as SSE — each agent message is emitted when ready (show + TTS immediately)',
  })
  async streamTurn(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SubmitTurnDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      await this.service.submitTurn(tenantId, id, dto, send)
    } catch (err: any) {
      send({ type: 'error', message: err?.message ?? 'Turn failed' })
    } finally {
      res.end()
    }
  }

  @Post('sessions/:id/barge-in')
  @ApiOperation({ summary: 'Interrupt the current speaking/generating turn' })
  bargeIn(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: BargeInDto,
  ) {
    return this.service.bargeIn(tenantId, id, dto.turnId)
  }
}
