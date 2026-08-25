import { Module } from '@nestjs/common'
import { AIModule } from '../../ai/ai.module'
import { ChatModule } from '../chat/chat.module'
import { ConferenceController } from './conference.controller'
import { ConferenceService } from './conference.service'
import { FeatureFlagsModule } from '../../common/feature-flags/feature-flags.module'

@Module({
  imports: [ChatModule, AIModule, FeatureFlagsModule],
  controllers: [ConferenceController],
  providers: [ConferenceService],
  exports: [ConferenceService],
})
export class ConferenceModule {}
