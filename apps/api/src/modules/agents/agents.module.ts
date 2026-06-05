import { Module } from '@nestjs/common'
import { AgentsService } from './agents.service'
import { AgentsController } from './agents.controller'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [AIModule],
  providers: [AgentsService],
  controllers: [AgentsController],
  exports: [AgentsService],
})
export class AgentsModule {}
