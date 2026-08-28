import { Controller, Get, Post, Put, Param, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsArray, ValidateNested, IsIn, IsObject } from 'class-validator'
import { Type } from 'class-transformer'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { HierarchyService, SaveLayoutDto } from './hierarchy.service'

class NodeUpdateDto {
  @IsString() id: string
  @IsIn(['staff', 'agent']) type: 'staff' | 'agent'
  // managerId / supervisorUserId can be a string id OR null (to unset the relationship)
  @IsOptional() managerId?: string | null
  @IsOptional() supervisorUserId?: string | null
  @IsOptional() @IsString() designation?: string
  @IsOptional() @IsString() department?: string
  @IsOptional() @IsString() phone?: string
  @IsOptional() position?: { x: number; y: number }
}

class EscalationRuleDto {
  @IsOptional() @IsString() id?: string
  @IsString() agentId: string
  @IsOptional() @IsString() agentName?: string
  @IsOptional() @IsString() agentRole?: string
  @IsString() trigger: string
  @IsString() triggerLabel: string
  @IsOptional() @IsString() action?: string
  @IsOptional() @IsString() targetUserId?: string
  @IsOptional() @IsString() targetAgentId?: string
  @IsOptional() @IsString() urgency?: string
}

class SaveHierarchyDto {
  @IsOptional() @IsObject() layout?: SaveLayoutDto['layout']
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => NodeUpdateDto)
  nodeUpdates?: NodeUpdateDto[]
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => EscalationRuleDto)
  escalationRules?: EscalationRuleDto[]
}

@ApiTags('Hierarchy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hierarchy')
export class HierarchyController {
  constructor(private readonly svc: HierarchyService) {}

  @Get()
  @Roles('TENANT_OWNER', 'TENANT_ADMIN', 'MANAGER', 'USER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get org hierarchy (staff + agents + positions + escalations)' })
  getHierarchy(@CurrentTenant() tenantId: string) {
    return this.svc.getHierarchy(tenantId)
  }

  @Put()
  @Roles('TENANT_OWNER', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Save full hierarchy layout + node changes + escalation rules' })
  saveLayout(@CurrentTenant() tenantId: string, @Body() body: SaveHierarchyDto) {
    return this.svc.saveLayout(tenantId, body)
  }

  @Get('agent-context/:agentId')
  @Roles('TENANT_OWNER', 'TENANT_ADMIN', 'MANAGER', 'USER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get hierarchy context string for agent system prompt injection' })
  getAgentContext(@CurrentTenant() tenantId: string, @Param('agentId') agentId: string) {
    return this.svc.getAgentContext(tenantId, agentId).then((ctx) => ({ context: ctx }))
  }

  @Post('ai-suggest')
  @Roles('TENANT_OWNER', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Use AI to suggest optimal org hierarchy based on staff designations and agent roles' })
  aiSuggest(@CurrentTenant() tenantId: string, @Body() body: { customInstructions?: string }) {
    return this.svc.aiSuggestHierarchy(tenantId, body?.customInstructions)
  }

  @Post('ai-refine')
  @Roles('TENANT_OWNER', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Apply a natural-language correction to the current hierarchy' })
  aiRefine(
    @CurrentTenant() tenantId: string,
    @Body() body: {
      instruction: string
      currentNodes: Array<{ id: string; type: string; label: string; designation?: string; managerId?: string; supervisorUserId?: string }>
      currentEdges: Array<{ source: string; target: string; type: string }>
    },
  ) {
    return this.svc.aiRefineHierarchy(tenantId, body.instruction, body.currentNodes, body.currentEdges)
  }
}
