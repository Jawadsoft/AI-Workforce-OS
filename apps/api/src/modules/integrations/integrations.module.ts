import { Module, forwardRef } from '@nestjs/common'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { AIModule } from '../../ai/ai.module'
import { IntegrationsService } from './integrations.service'
import { IntegrationsController } from './integrations.controller'
import { EmailScannerScheduler } from './email-scanner.scheduler'
import { ChatModule } from '../chat/chat.module'

@Module({
  imports: [PrismaModule, AIModule, forwardRef(() => ChatModule)],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, EmailScannerScheduler],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
