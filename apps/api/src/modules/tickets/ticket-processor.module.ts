import { Module, forwardRef } from '@nestjs/common'
import { TicketProcessorScheduler } from './ticket-processor.scheduler'
import { CrmLeadScannerScheduler } from './crm-lead-scanner.scheduler'
import { OperationsController } from './operations.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { ChatModule } from '../chat/chat.module'
import { CrmModule } from '../crm/crm.module'
import { IntegrationsModule } from '../integrations/integrations.module'

@Module({
  imports: [PrismaModule, forwardRef(() => ChatModule), CrmModule, IntegrationsModule],
  providers: [TicketProcessorScheduler, CrmLeadScannerScheduler],
  controllers: [OperationsController],
  exports: [TicketProcessorScheduler, CrmLeadScannerScheduler],
})
export class TicketProcessorModule { }
