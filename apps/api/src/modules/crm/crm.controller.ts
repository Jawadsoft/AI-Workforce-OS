import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsBoolean } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { CrmService } from './crm.service'
import { INDUSTRY_CRM_DEFAULTS } from './crm.interface'

class CreateConnectionDto {
  @IsString() provider: string
  @IsString() name: string
  @IsOptional() @IsString() baseUrl?: string
  @IsOptional() @IsString() apiKey?: string
}

class UpdateConnectionDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() baseUrl?: string
  @IsOptional() @IsString() apiKey?: string
  @IsOptional() @IsBoolean() isActive?: boolean
}

class CreateNoteDto {
  @IsString() content: string
  @IsOptional() @IsString() customerId?: string
  @IsOptional() @IsString() jobId?: string
}

class UpdateRecordDto {
  @IsString() model: string
  @IsString() recordId: string
  data: Record<string, unknown>
}

@ApiTags('CRM')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly service: CrmService) {}

  // ── Connections ──────────────────────────────────────────────────

  @Get('connections')
  @ApiOperation({ summary: 'List all CRM connections' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId)
  }

  @Post('connections')
  @ApiOperation({ summary: 'Add a CRM connection' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateConnectionDto) {
    return this.service.create(tenantId, dto)
  }

  @Patch('connections/:id')
  @ApiOperation({ summary: 'Update a CRM connection' })
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateConnectionDto) {
    return this.service.update(tenantId, id, dto)
  }

  @Delete('connections/:id')
  @ApiOperation({ summary: 'Remove a CRM connection' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id)
  }

  @Post('connections/:id/test')
  @ApiOperation({ summary: 'Test a CRM connection' })
  test(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.testConnection(tenantId, id)
  }

  // ── CRM Operations ────────────────────────────────────────────────

  @Get('contacts')
  @ApiOperation({ summary: 'Search contacts in connected CRM' })
  searchContacts(@CurrentTenant() tenantId: string, @Query('q') q: string) {
    return this.service.searchContacts(tenantId, q ?? '')
  }

  @Get('contacts/:id')
  @ApiOperation({ summary: 'Get a single contact' })
  getContact(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getContact(tenantId, id)
  }

  @Post('notes')
  @ApiOperation({ summary: 'Create a note in the CRM' })
  createNote(@CurrentTenant() tenantId: string, @Body() dto: CreateNoteDto) {
    return this.service.createNote(tenantId, dto)
  }

  @Post('update-record')
  @ApiOperation({ summary: 'Update a record in the CRM' })
  updateRecord(@CurrentTenant() tenantId: string, @Body() dto: UpdateRecordDto) {
    return this.service.updateRecord(tenantId, dto.model, dto.recordId, dto.data)
  }

  // ── Extended CRM data endpoints ───────────────────────────────────

  @Get('leads')
  @ApiOperation({ summary: 'Search leads in connected CRM' })
  searchLeads(@CurrentTenant() tenantId: string, @Query('q') q: string) {
    return this.service.searchLeads(tenantId, q ?? '')
  }

  @Get('contacts/:id/jobs')
  @ApiOperation({ summary: 'Get jobs for a customer' })
  getJobsByCustomer(@CurrentTenant() tenantId: string, @Param('id') customerId: string) {
    return this.service.getJobsByCustomer(tenantId, customerId)
  }

  @Get('contacts/:id/proposals')
  @ApiOperation({ summary: 'Get proposals for a customer' })
  getProposalsByCustomer(@CurrentTenant() tenantId: string, @Param('id') customerId: string) {
    return this.service.getProposalsByCustomer(tenantId, customerId)
  }

  @Get('contacts/:id/notes')
  @ApiOperation({ summary: 'Get note history for a customer' })
  getNoteHistory(@CurrentTenant() tenantId: string, @Param('id') customerId: string) {
    return this.service.getNoteHistory(tenantId, customerId)
  }

  @Get('jobs/:id/materials')
  @ApiOperation({ summary: 'Get materials list for a job' })
  getMaterials(@CurrentTenant() tenantId: string, @Param('id') jobId: string) {
    return this.service.getMaterialsList(tenantId, jobId)
  }

  // ── Agent CRM permissions ─────────────────────────────────────────

  @Post('connections/:id/grant/:agentId')
  @ApiOperation({ summary: 'Grant agent access to a CRM connection' })
  grantAccess(
    @CurrentTenant() tenantId: string,
    @Param('id') connectionId: string,
    @Param('agentId') agentId: string,
    @Body('permissions') permissions: string[],
  ) {
    return this.service.grantAgentAccess(connectionId, agentId, permissions)
  }

  @Delete('connections/:id/revoke/:agentId')
  @ApiOperation({ summary: 'Revoke agent access to a CRM connection' })
  revokeAccess(
    @CurrentTenant() tenantId: string,
    @Param('id') connectionId: string,
    @Param('agentId') agentId: string,
  ) {
    return this.service.revokeAgentAccess(connectionId, agentId)
  }

  // ── Industry defaults ────────────────────────────────────────────

  @Get('industry-defaults')
  @ApiOperation({ summary: 'Get CRM tool defaults for all industries' })
  getIndustryDefaults() {
    return INDUSTRY_CRM_DEFAULTS
  }

  @Get('industry-defaults/:industry')
  @ApiOperation({ summary: 'Get CRM tool defaults for a specific industry' })
  getIndustryDefault(@Param('industry') industry: string) {
    return INDUSTRY_CRM_DEFAULTS[industry.toUpperCase()] ?? null
  }
}
