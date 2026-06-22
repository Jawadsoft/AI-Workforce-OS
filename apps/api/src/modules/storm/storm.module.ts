import { Module } from '@nestjs/common'
import { StormService } from './storm.service'
import { StormScheduler } from './storm.scheduler'
import { StormController } from './storm.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [PrismaModule, AIModule],
  controllers: [StormController],
  providers: [StormService, StormScheduler],
  exports: [StormService],
})
export class StormModule {}
