import { Module } from '@nestjs/common'
import { TasksService } from './tasks.service'
import { TasksController } from './tasks.controller'
import { RecurringTaskScheduler } from './recurring-task.scheduler'
import { CrmModule } from '../crm/crm.module'
import { StormModule } from '../storm/storm.module'
import { PrismaModule } from '../../common/prisma/prisma.module'

@Module({
  imports: [PrismaModule, CrmModule, StormModule],
  providers: [TasksService, RecurringTaskScheduler],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
