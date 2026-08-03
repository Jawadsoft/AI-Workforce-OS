import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { MessageEmbeddingProcessor } from './processors/message-embedding.processor'
import { AIModule } from '../ai/ai.module'

// PrismaModule is @Global() — PrismaService is available without explicit import
@Module({
  imports: [
    BullModule.registerQueue({ name: 'message-embedding' }),
    AIModule,
  ],
  providers: [MessageEmbeddingProcessor],
})
export class MessageEmbeddingModule {}
