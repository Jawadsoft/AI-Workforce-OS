import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { StormService } from './storm.service'

@ApiTags('storm')
@UseGuards(JwtAuthGuard)
@Controller('storm')
export class StormController {
  constructor(private readonly stormService: StormService) {}

  @Post('trigger')
  @ApiOperation({ summary: 'Manually trigger a storm report scrape for today/yesterday' })
  async triggerScrape(
    @CurrentTenant() tenantId: string,
    @Query('date') dateStr?: string,
  ) {
    const targetDate = dateStr ? new Date(dateStr) : undefined
    await this.stormService.generateAndPostBriefing(tenantId, targetDate)
    return { success: true, message: 'Storm briefing generated and posted to Arturo\'s thread.' }
  }

  @Get('reports')
  @ApiOperation({ summary: 'Query stored storm reports' })
  async getReports(
    @CurrentTenant() tenantId: string,
    @Query('type') type?: 'hail' | 'tornado' | 'wind',
    @Query('state') state?: string,
    @Query('minSize') minSize?: string,
    @Query('days') days?: string,
    @Query('date') date?: string,
    @Query('county') county?: string,
  ) {
    return this.stormService.queryReports(tenantId, {
      type,
      state,
      minSize: minSize ? parseFloat(minSize) : undefined,
      days: days ? parseInt(days, 10) : undefined,
      date,
      county,
    })
  }
}
