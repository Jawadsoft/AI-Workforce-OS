import { Controller, Get, Post, Patch, Body, Param, UseGuards, BadRequestException } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsArray } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { BrainService } from './brain.service'

class EnrichDto {
  @IsString() websiteUrl: string
}

class ManualContextDto {
  @IsOptional() @IsString() targetCustomerProfile?: string
  @IsOptional() @IsString() competitors?: string
  @IsOptional() @IsString() priceRange?: string
  @IsOptional() @IsString() forbiddenTopics?: string
  @IsOptional() @IsString() escalationContacts?: string
  @IsOptional() @IsString() uniqueSellingPoints?: string
}

class UpdateScrapedDataDto {
  @IsOptional() @IsString() companyName?: string
  @IsOptional() @IsString() tagline?: string
  @IsOptional() @IsString() companyDescription?: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() industry?: string
  @IsOptional() @IsArray() services?: string[]
  @IsOptional() @IsString() targetCustomers?: string
  @IsOptional() @IsArray() uniqueSellingPoints?: string[]
  @IsOptional() @IsArray() serviceAreas?: string[]
  @IsOptional() @IsString() phone?: string
  @IsOptional() @IsString() email?: string
  @IsOptional() @IsString() address?: string
  @IsOptional() @IsString() pricingSignals?: string
  @IsOptional() @IsString() businessRules?: string
  @IsOptional() @IsString() brandVoice?: string
  @IsOptional() @IsString() teamSize?: string
  @IsOptional() @IsString() yearsInBusiness?: string
}

@ApiTags('Brain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('brain')
export class BrainController {
  constructor(private readonly service: BrainService) {}

  @Post('enrich')
  @ApiOperation({ summary: 'Scrape website and auto-enrich tenant brain with AI' })
  enrich(@CurrentTenant() tenantId: string, @Body() dto: EnrichDto) {
    return this.service.enrich(tenantId, dto.websiteUrl)
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get the enriched brain profile for the current tenant' })
  getProfile(@CurrentTenant() tenantId: string) {
    return this.service.getProfile(tenantId)
  }

  @Patch('manual-context')
  @ApiOperation({ summary: 'Save manual business context overrides' })
  saveManualContext(@CurrentTenant() tenantId: string, @Body() dto: ManualContextDto) {
    return this.service.saveManualContext(tenantId, dto)
  }

  @Patch('scraped-data')
  @ApiOperation({ summary: 'Directly edit any auto-extracted brain field (company name, services, description, etc.)' })
  updateScrapedData(@CurrentTenant() tenantId: string, @Body() dto: UpdateScrapedDataDto) {
    return this.service.updateScrapedData(tenantId, dto)
  }

  @Patch('playbook')
  @ApiOperation({ summary: 'Save the operational playbook / workflow bible for autonomous agents' })
  savePlaybook(@CurrentTenant() tenantId: string, @Body() body: Record<string, any>): Promise<any> {
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid playbook data')
    return this.service.savePlaybook(tenantId, body)
  }

  @Get('crm-guides')
  @ApiOperation({ summary: 'List all available CRM setup guides' })
  getCrmGuides() {
    return this.service.getAllCrmGuides()
  }

  @Get('crm-guides/:provider')
  @ApiOperation({ summary: 'Get detailed CRM setup guide for a specific provider' })
  getCrmGuide(@Param('provider') provider: string) {
    return this.service.getCrmGuide(provider)
  }
}
