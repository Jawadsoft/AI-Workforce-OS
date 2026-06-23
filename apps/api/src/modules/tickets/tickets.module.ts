import { Global, Module } from '@nestjs/common'
import { TicketsService } from './tickets.service'
import { TicketsController } from './tickets.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'

@Global()
@Module({
  imports: [PrismaModule],
  providers: [TicketsService],
  controllers: [TicketsController],
  exports: [TicketsService],
})
export class TicketsModule {}
