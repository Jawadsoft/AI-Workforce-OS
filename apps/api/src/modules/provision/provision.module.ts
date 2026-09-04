import { Module } from '@nestjs/common'
import { ProvisionController } from './provision.controller'
import { SuperAdminModule } from '../super-admin/super-admin.module'

@Module({
  imports: [SuperAdminModule],
  controllers: [ProvisionController],
})
export class ProvisionModule {}
