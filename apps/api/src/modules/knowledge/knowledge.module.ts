import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { KnowledgeService } from './knowledge.service'
import { KnowledgeController } from './knowledge.controller'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [
    AIModule,
    MulterModule.register({ dest: './uploads' }),
  ],
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
