import { Module } from '@nestjs/common'
import { HannaScheduler } from './hanna-scheduler'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { ChatModule } from '../chat/chat.module'

@Module({
  imports: [PrismaModule, ChatModule],
  providers: [HannaScheduler],
})
export class HannaSchedulerModule {}
