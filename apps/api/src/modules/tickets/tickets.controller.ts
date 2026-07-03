import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, Request,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { TicketsService } from './tickets.service'

class CreateTicketDto {
  @IsString() title: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() type?: string
  @IsOptional() @IsString() priority?: string
  @IsOptional() @IsString() contactRef?: string
  @IsOptional() @IsString() contactPhone?: string
  @IsOptional() @IsString() contactEmail?: string
  @IsOptional() @IsString() assignedAgentId?: string
  @IsOptional() @IsString() nextAction?: string
  @IsOptional() @IsString() followUpAt?: string
  @IsOptional() metadata?: any
}

class UpdateTicketDto {
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() priority?: string
  @IsOptional() @IsString() nextAction?: string
  @IsOptional() @IsString() note?: string
  @IsOptional() @IsString() assignedAgentId?: string
  @IsOptional() @IsString() followUpAt?: string
}

@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly service: TicketsService) {}

  @Get()
  @ApiOperation({ summary: 'List all tickets for the tenant' })
  findAll(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('assignedAgentId') assignedAgentId?: string,
    @Query('contactRef') contactRef?: string,
    @Query('type') type?: string,
  ) {
    return this.service.findAll(req.user.tenantId, { status, source, assignedAgentId, contactRef, type })
  }

  @Get('lead/:leadId/journey')
  @ApiOperation({ summary: 'Get the full stage-by-stage journey for a CRM lead' })
  getLeadJourney(@Request() req: any, @Param('leadId') leadId: string) {
    return this.service.getLeadJourney(req.user.tenantId, leadId)
  }

  @Get('agent/:agentId')
  @ApiOperation({ summary: 'Get pending tickets for a specific agent' })
  getForAgent(@Request() req: any, @Param('agentId') agentId: string) {
    return this.service.getForAgent(req.user.tenantId, agentId)
  }

  @Get(':id/thread')
  @ApiOperation({ summary: 'Get a ticket with its full conversation thread' })
  getWithThread(@Request() req: any, @Param('id') id: string) {
    return this.service.getWithThread(req.user.tenantId, id)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single ticket' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Create a new activity ticket' })
  create(@Request() req: any, @Body() dto: CreateTicketDto) {
    return this.service.create(req.user.tenantId, req.user.sub, req.user.name ?? 'User', dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a ticket status, next action, or assignment' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.service.update(req.user.tenantId, id, req.user.sub, req.user.name ?? 'User', dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a ticket' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.tenantId, id)
  }
}
