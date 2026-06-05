import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { AIModule } from '../../ai/ai.module'
import { CrmModule } from '../crm/crm.module'
import { BrainModule } from '../brain/brain.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'

@Module({
  imports: [AIModule, CrmModule, BrainModule, KnowledgeModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
