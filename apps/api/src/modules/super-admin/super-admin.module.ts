import { Module } from '@nestjs/common'
import { SuperAdminService } from './super-admin.service'
import { SuperAdminController, SuperAdminBootstrapController } from './super-admin.controller'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { FeatureFlagsModule } from '../../common/feature-flags/feature-flags.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { AIModule } from '../../ai/ai.module'
import { HelpModule } from '../help/help.module'

@Module({
  imports: [PrismaModule, FeatureFlagsModule, AIModule, KnowledgeModule, HelpModule],
  providers: [SuperAdminService],
  controllers: [SuperAdminController, SuperAdminBootstrapController],
})
export class SuperAdminModule {}
