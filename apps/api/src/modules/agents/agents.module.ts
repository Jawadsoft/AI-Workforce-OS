import { Module } from '@nestjs/common'
import { AgentsService } from './agents.service'
import { AgentsController } from './agents.controller'
import { AIModule } from '../../ai/ai.module'
import { PrismaModule } from '../../common/prisma/prisma.module'

@Module({
  imports: [AIModule, PrismaModule],
  providers: [AgentsService],
  controllers: [AgentsController],
  exports: [AgentsService],
})
export class AgentsModule {}
