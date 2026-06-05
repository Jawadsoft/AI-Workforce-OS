import { Module } from '@nestjs/common'
import { CommunicationsController } from './communications.controller'
import { CommunicationsService } from './communications.service'
import { TwilioService } from './twilio.service'
// PrismaService is provided globally via app.module
import { AIModule } from '../../ai/ai.module'
import { BrainModule } from '../brain/brain.module'
import { CrmModule } from '../crm/crm.module'

@Module({
  imports: [AIModule, BrainModule, CrmModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, TwilioService],
  exports: [CommunicationsService, TwilioService],
})
export class CommunicationsModule {}
