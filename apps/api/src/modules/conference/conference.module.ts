import { Module } from '@nestjs/common'
import { AIModule } from '../../ai/ai.module'
import { ChatModule } from '../chat/chat.module'
import { ConferenceController } from './conference.controller'
import { ConferenceService } from './conference.service'

@Module({
  imports: [ChatModule, AIModule],
  controllers: [ConferenceController],
  providers: [ConferenceService],
  exports: [ConferenceService],
})
export class ConferenceModule {}
