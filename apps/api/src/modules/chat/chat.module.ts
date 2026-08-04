import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
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
import { SocialModule } from '../social/social.module'
import { InspectionModule } from '../inspection/inspection.module'
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module'
import { RealtimeModule } from '../../realtime/realtime.module'

// PublicChatModule is @Global() so PublicChatService is available everywhere
// without importing the module here — importing it would create a circular
// TypeScript file dependency and crash module scanning.
@Module({
  imports: [
    BullModule.registerQueue({ name: 'knowledge-processing' }, { name: 'message-embedding' }),
    AIModule, CrmModule, BrainModule, KnowledgeModule, TasksModule,
    DocumentsModule, StormModule, MemoryModule, SocialModule, InspectionModule, CloudinaryModule,
    RealtimeModule,
  ],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
