import { Module } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { EmailModule } from '../email/email.module'

@Module({
  imports: [PrismaModule, EmailModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
