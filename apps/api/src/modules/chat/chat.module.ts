import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { AIModule } from '../../ai/ai.module'
import { CrmModule } from '../crm/crm.module'
import { BrainModule } from '../brain/brain.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { TasksModule } from '../tasks/tasks.module'
import { DocumentsModule } from '../documents/documents.module'
import { StormModule } from '../storm/storm.module'

@Module({
  imports: [AIModule, CrmModule, BrainModule, KnowledgeModule, TasksModule, DocumentsModule, StormModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
