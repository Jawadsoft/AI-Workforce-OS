import { Controller, Post, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'
import { SocialDailyScheduler } from './social-daily-scheduler'

@ApiTags('Social Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/daily-wake')
export class SocialDailySchedulerController {
  constructor(private readonly scheduler: SocialDailyScheduler) {}

  @Post('trigger')
  @ApiOperation({
    summary: 'Manually trigger the daily proactive social media wake for testing (bypasses the 20h cooldown)',
  })
  async trigger(@CurrentTenant() tenantId: string) {
    return this.scheduler.triggerForTenant(tenantId, true)
  }
}
