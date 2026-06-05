import { Module } from '@nestjs/common'
import { BrainService } from './brain.service'
import { BrainController } from './brain.controller'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [AIModule],
  providers: [BrainService],
  controllers: [BrainController],
  exports: [BrainService],
})
export class BrainModule {}
