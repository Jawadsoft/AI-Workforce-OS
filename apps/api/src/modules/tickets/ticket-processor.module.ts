import { Module, forwardRef } from '@nestjs/common'
import { TicketProcessorScheduler } from './ticket-processor.scheduler'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { ChatModule } from '../chat/chat.module'

// forwardRef is used here defensively — not because a true module cycle exists
// (ChatModule does not import TicketProcessorModule), but because the hot-reload
// recompilation chain (tickets.service → chat.service → public-chat.service)
// can temporarily leave ChatModule undefined during a restart. The lazy resolution
// prevents NestJS from reading .name on an undefined controller class.
@Module({
  imports: [PrismaModule, forwardRef(() => ChatModule)],
  providers: [TicketProcessorScheduler],
})
export class TicketProcessorModule {}
