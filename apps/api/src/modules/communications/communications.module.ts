import { Module } from '@nestjs/common'
import { CommunicationsController } from './communications.controller'
import { CommunicationsService } from './communications.service'
import { TwilioModule } from './twilio.module'
import { AIModule } from '../../ai/ai.module'
import { BrainModule } from '../brain/brain.module'
import { ChatModule } from '../chat/chat.module'
import { CrmModule } from '../crm/crm.module'

@Module({
  imports: [AIModule, BrainModule, CrmModule, ChatModule, TwilioModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService],
  exports: [CommunicationsService, TwilioModule],
})
export class CommunicationsModule {}
