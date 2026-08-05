import { Controller, Post, Delete, Body, HttpCode, HttpStatus, Headers, UnauthorizedException, Param } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger'
import { IsEmail, IsString, IsOptional } from 'class-validator'
import { IntegrationService } from './integration.service'

class ProvisionTenantDto {
  @IsString() companyName: string
  @IsString() ownerName: string
  @IsEmail() ownerEmail: string
  @IsOptional() @IsString() industry?: string
  @IsOptional() @IsString() externalTenantId?: string // StormBuddi tenant ID
}

class SuspendTenantDto {
  @IsString() tenantId: string
}

@ApiTags('External Integrations')
@Controller('integrations')
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}

  // Helper method to verify API key
  private verifyApiKey(apiKey: string | undefined): void {
    const validApiKey = process.env.INTEGRATION_API_KEY
    if (!validApiKey || !apiKey || apiKey !== validApiKey) {
      throw new UnauthorizedException('Invalid API key')
    }
  }

  @Post('provision-tenant')
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({ name: 'x-api-key', description: 'API Key for external integrations' })
  @ApiOperation({ 
    summary: 'Provision a new tenant from external CRM (e.g., StormBuddi)',
    description: 'Creates a new tenant and owner user. Returns tenant ID and verification link. Requires API key authentication.'
  })
  async provisionTenant(
    @Headers('x-api-key') apiKey: string,
    @Body() dto: ProvisionTenantDto,
  ) {
    this.verifyApiKey(apiKey)
    return this.service.provisionTenant(dto)
  }

  @Post('suspend-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'x-api-key', description: 'API Key for external integrations' })
  @ApiOperation({ 
    summary: 'Suspend a tenant (e.g., when plan is downgraded)',
    description: 'Suspends tenant access but keeps data. Requires API key authentication.'
  })
  async suspendTenant(
    @Headers('x-api-key') apiKey: string,
    @Body() dto: SuspendTenantDto,
  ) {
    this.verifyApiKey(apiKey)
    return this.service.suspendTenant(dto.tenantId)
  }

  @Post('activate-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'x-api-key', description: 'API Key for external integrations' })
  @ApiOperation({ 
    summary: 'Reactivate a suspended tenant (e.g., when plan is upgraded)',
    description: 'Reactivates a previously suspended tenant. Requires API key authentication.'
  })
  async activateTenant(
    @Headers('x-api-key') apiKey: string,
    @Body() dto: SuspendTenantDto,
  ) {
    this.verifyApiKey(apiKey)
    return this.service.activateTenant(dto.tenantId)
  }

  @Delete('tenant/:tenantId')
  @ApiHeader({ name: 'x-api-key', description: 'API Key for external integrations' })
  @ApiOperation({ 
    summary: 'Permanently delete a tenant and all associated data',
    description: 'WARNING: This action is irreversible. Requires API key authentication.'
  })
  async deleteTenant(
    @Headers('x-api-key') apiKey: string,
    @Param('tenantId') tenantId: string,
  ) {
    this.verifyApiKey(apiKey)
    return this.service.deleteTenant(tenantId)
  }
}
