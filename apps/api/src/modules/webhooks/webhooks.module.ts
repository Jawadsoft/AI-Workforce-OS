import { Module, forwardRef } from '@nestjs/common'
import { WebhooksService } from './webhooks.service'
import { WebhooksController } from './webhooks.controller'
import { CrmModule } from '../crm/crm.module'
import { BrainModule } from '../brain/brain.module'
import { AIModule } from '../../ai/ai.module'
import { ChatModule } from '../chat/chat.module'
import { SocialModule } from '../social/social.module'

@Module({
  imports: [AIModule, CrmModule, BrainModule, forwardRef(() => ChatModule), SocialModule],
  providers: [WebhooksService],
  controllers: [WebhooksController],
  exports: [WebhooksService],
})
export class WebhooksModule {}
