import { Module, forwardRef } from '@nestjs/common'
import { TicketProcessorScheduler } from './ticket-processor.scheduler'
import { CrmLeadScannerScheduler } from './crm-lead-scanner.scheduler'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { ChatModule } from '../chat/chat.module'
import { CrmModule } from '../crm/crm.module'

@Module({
  imports: [PrismaModule, forwardRef(() => ChatModule), CrmModule],
  providers: [TicketProcessorScheduler, CrmLeadScannerScheduler],
  exports: [TicketProcessorScheduler, CrmLeadScannerScheduler],
})
export class TicketProcessorModule { }
