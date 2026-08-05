import { Module, forwardRef } from '@nestjs/common'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { AIModule } from '../../ai/ai.module'
import { IntegrationsService } from './integrations.service'
import { IntegrationsController } from './integrations.controller'
import { IntegrationController } from './integration.controller'
import { IntegrationService } from './integration.service'
import { EmailScannerScheduler } from './email-scanner.scheduler'
import { ChatModule } from '../chat/chat.module'
import { EmailModule } from '../email/email.module'

@Module({
  imports: [PrismaModule, AIModule, forwardRef(() => ChatModule), EmailModule],
  controllers: [IntegrationsController, IntegrationController],
  providers: [IntegrationsService, IntegrationService, EmailScannerScheduler],
  exports: [IntegrationsService, IntegrationService, EmailScannerScheduler],
})
export class IntegrationsModule {}
