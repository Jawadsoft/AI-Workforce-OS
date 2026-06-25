import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { KnowledgeService } from './knowledge.service'
import { KnowledgeController } from './knowledge.controller'
import { IndustryKnowledgeService } from './industry-knowledge.service'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [
    AIModule,
    MulterModule.register(),
  ],
  providers: [KnowledgeService, IndustryKnowledgeService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService, IndustryKnowledgeService],
})
export class KnowledgeModule {}
