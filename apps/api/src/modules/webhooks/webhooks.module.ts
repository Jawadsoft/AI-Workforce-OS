import { Module } from '@nestjs/common'
import { WebhooksService } from './webhooks.service'
import { WebhooksController } from './webhooks.controller'
import { CrmModule } from '../crm/crm.module'
import { BrainModule } from '../brain/brain.module'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [AIModule, CrmModule, BrainModule],
  providers: [WebhooksService],
  controllers: [WebhooksController],
  exports: [WebhooksService],
})
export class WebhooksModule {}
