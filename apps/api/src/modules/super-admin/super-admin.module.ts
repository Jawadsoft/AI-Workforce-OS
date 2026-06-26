import { Module } from '@nestjs/common'
import { SuperAdminService } from './super-admin.service'
import { SuperAdminController, SuperAdminBootstrapController } from './super-admin.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { FeatureFlagsModule } from '../../common/feature-flags/feature-flags.module'

@Module({
  imports: [PrismaModule, FeatureFlagsModule],
  providers: [SuperAdminService],
  controllers: [SuperAdminController, SuperAdminBootstrapController],
})
export class SuperAdminModule {}
