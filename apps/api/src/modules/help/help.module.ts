import { Module } from '@nestjs/common'
import { HelpService } from './help.service'
import { HelpController } from './help.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [HelpController],
  providers: [HelpService],
  exports: [HelpService],
})
export class HelpModule {}
