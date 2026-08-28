import { Module } from '@nestjs/common'
import { HierarchyService } from './hierarchy.service'
import { HierarchyController } from './hierarchy.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { AIModule } from '../../ai/ai.module'

@Module({
  imports: [PrismaModule, AIModule],
  providers: [HierarchyService],
  controllers: [HierarchyController],
  exports: [HierarchyService],
})
export class HierarchyModule {}
