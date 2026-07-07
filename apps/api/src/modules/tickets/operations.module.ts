import { Module, forwardRef } from '@nestjs/common'
import { OperationsController } from './operations.controller'
import { TicketProcessorModule } from './ticket-processor.module'
import { IntegrationsModule } from '../integrations/integrations.module'
import { TestJourneyService } from './test-journey.service'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { ChatModule } from '../chat/chat.module'
import { CrmModule } from '../crm/crm.module'

/**
 * Standalone module for the OperationsController.
 * Kept separate from TicketProcessorModule to avoid circular deps.
 */
@Module({
  imports: [
    PrismaModule,
    CrmModule,
    forwardRef(() => TicketProcessorModule),
    forwardRef(() => IntegrationsModule),
    forwardRef(() => ChatModule),
  ],
  controllers: [OperationsController],
  providers: [TestJourneyService],
})
export class OperationsModule {}
