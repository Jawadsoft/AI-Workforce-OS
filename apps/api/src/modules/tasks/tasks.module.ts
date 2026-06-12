import { Module } from '@nestjs/common'
import { TasksService } from './tasks.service'
import { TasksController } from './tasks.controller'
import { CrmModule } from '../crm/crm.module'
import { PrismaModule } from '../../common/prisma/prisma.module'

@Module({
  imports: [PrismaModule, CrmModule],
  providers: [TasksService],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
