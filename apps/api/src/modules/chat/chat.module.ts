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
import { MemoryModule } from '../memory/memory.module'

// PublicChatModule is @Global() so PublicChatService is available everywhere
// without importing the module here — importing it would create a circular
// TypeScript file dependency and crash module scanning.
@Module({
  imports: [AIModule, CrmModule, BrainModule, KnowledgeModule, TasksModule, DocumentsModule, StormModule, MemoryModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
