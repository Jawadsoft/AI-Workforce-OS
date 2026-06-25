import { Module } from '@nestjs/common'
import { MemoryService } from './memory.service'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [AIModule],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
