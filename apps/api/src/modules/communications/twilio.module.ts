import { Module } from '@nestjs/common'
import { TwilioService } from './twilio.service'
import { PrismaModule } from '../../common/prisma/prisma.module'

/**
 * Standalone module exposing only TwilioService.
 * Kept separate from CommunicationsModule so ChatModule can import it
 * without creating a circular dependency (CommunicationsModule → ChatModule).
 */
@Module({
  imports: [PrismaModule],
  providers: [TwilioService],
  exports: [TwilioService],
})
export class TwilioModule {}
