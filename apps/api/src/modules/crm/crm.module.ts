import { Module } from '@nestjs/common'
import { CrmService } from './crm.service'
import { CrmController } from './crm.controller'
import { CrmContextService } from './crm-context.service'
import { PrismaModule } from '../../common/prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [CrmService, CrmContextService],
  controllers: [CrmController],
  exports: [CrmService, CrmContextService],
})
export class CrmModule {}
