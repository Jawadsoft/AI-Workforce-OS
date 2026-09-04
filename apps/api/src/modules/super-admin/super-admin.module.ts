import { Module } from '@nestjs/common'
import { SuperAdminService } from './super-admin.service'
import { SuperAdminController, SuperAdminBootstrapController } from './super-admin.controller'
import { SuperAdminGuard } from '../../common/guards/super-admin.guard'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { FeatureFlagsModule } from '../../common/feature-flags/feature-flags.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { AIModule } from '../../ai/ai.module'
import { HelpModule } from '../help/help.module'
import { BrainModule } from '../brain/brain.module'

@Module({
  imports: [PrismaModule, FeatureFlagsModule, AIModule, KnowledgeModule, HelpModule, BrainModule],
  providers: [SuperAdminService, SuperAdminGuard],
  controllers: [SuperAdminController, SuperAdminBootstrapController],
  exports: [SuperAdminService],
})
export class SuperAdminModule {}
