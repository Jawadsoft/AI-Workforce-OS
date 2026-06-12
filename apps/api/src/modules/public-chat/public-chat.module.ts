import { Module, forwardRef } from '@nestjs/common'
import { PublicChatService } from './public-chat.service'
import { PublicChatController } from './public-chat.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { ChatModule } from '../chat/chat.module'

@Module({
  imports: [PrismaModule, forwardRef(() => ChatModule)],
  providers: [PublicChatService],
  controllers: [PublicChatController],
  exports: [PublicChatService],
})
export class PublicChatModule {}
