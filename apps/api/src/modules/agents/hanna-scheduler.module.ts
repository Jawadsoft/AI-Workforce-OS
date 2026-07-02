import { Module } from '@nestjs/common'
import { HannaScheduler } from './hanna-scheduler'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { ChatModule } from '../chat/chat.module'
import { NotificationModule } from '../notifications/notification.module'

@Module({
  imports: [PrismaModule, ChatModule, NotificationModule],
  providers: [HannaScheduler],
})
export class HannaSchedulerModule {}
