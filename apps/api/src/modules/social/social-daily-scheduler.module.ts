import { Module } from '@nestjs/common'
import { SocialDailyScheduler } from './social-daily-scheduler'
import { SocialDailySchedulerController } from './social-daily-scheduler.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { ChatModule } from '../chat/chat.module'

// Kept as its own module (not part of SocialModule) so it can depend on
// ChatModule for wakeAgentWithCapabilities without creating a circular
// dependency — ChatModule already imports SocialModule.
@Module({
  imports: [PrismaModule, ChatModule],
  providers: [SocialDailyScheduler],
  controllers: [SocialDailySchedulerController],
})
export class SocialDailySchedulerModule {}
