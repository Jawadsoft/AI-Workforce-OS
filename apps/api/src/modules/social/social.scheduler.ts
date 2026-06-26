import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { SocialService } from './social.service'

@Injectable()
export class SocialScheduler {
  private readonly logger = new Logger(SocialScheduler.name)

  constructor(private readonly social: SocialService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processDuePosts() {
    try {
      await this.social.processDuePosts()
    } catch (err) {
      this.logger.error(`Social post scheduler error: ${err}`)
    }
  }
}
