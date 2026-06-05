import { Module } from '@nestjs/common'
import { SuperAdminService } from './super-admin.service'
import { SuperAdminController, SuperAdminBootstrapController } from './super-admin.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [SuperAdminService],
  controllers: [SuperAdminController, SuperAdminBootstrapController],
})
export class SuperAdminModule {}
