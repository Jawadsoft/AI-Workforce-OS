import {
  Controller,
  Post,
  Body,
  Headers,
  BadRequestException,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { SuperAdminService } from '../super-admin/super-admin.service'

@ApiTags('Provision')
@Controller('provision')
export class ProvisionController {
  constructor(private readonly service: SuperAdminService) {}

  /**
   * Public endpoint — no JWT required.
   * Called by StormBuddi CRM (or any external system) to create a new tenant
   * and automatically assign it under the scoped admin that owns the provision key.
   *
   * Headers:
   *   x-provision-key: pk_live_<hex>
   *
   * Body:
   *   {
   *     companyName: string        // Tenant display name
   *     slug?: string              // URL slug (auto-generated if omitted)
   *     ownerName: string          // Full name of the tenant owner
   *     ownerEmail: string         // Email — receives the verification link
   *     industry?: string          // e.g. "ROOFING"
   *     phone?: string             // Optional
   *   }
   *
   * Response includes:
   *   tenant: { id, name, slug }
   *   owner: { id, email, name }
   *   clonedAgents: number
   *   verificationLink: string
   */
  @Post('tenant')
  @ApiOperation({ summary: 'Provision a new tenant using a scoped admin provision key' })
  provisionTenant(
    @Headers('x-provision-key') provisionKey: string,
    @Body()
    body: {
      companyName: string
      slug?: string
      ownerName: string
      ownerEmail: string
      industry?: string
      phone?: string
    },
  ) {
    if (!provisionKey) {
      throw new BadRequestException('Missing x-provision-key header')
    }
    if (!body.companyName || !body.ownerName || !body.ownerEmail) {
      throw new BadRequestException('companyName, ownerName, and ownerEmail are required')
    }
    return this.service.provisionTenantByKey(provisionKey, body)
  }
}
