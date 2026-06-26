import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './modules/auth/auth.module'
import { TenantsModule } from './modules/tenants/tenants.module'
import { AgentsModule } from './modules/agents/agents.module'
import { ChatModule } from './modules/chat/chat.module'
import { TasksModule } from './modules/tasks/tasks.module'
import { ApprovalsModule } from './modules/approvals/approvals.module'
import { KnowledgeModule } from './modules/knowledge/knowledge.module'
import { DocumentsModule } from './modules/documents/documents.module'
import { CrmModule } from './modules/crm/crm.module'
import { WebhooksModule } from './modules/webhooks/webhooks.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { AuditModule } from './modules/audit/audit.module'
import { BrainModule } from './modules/brain/brain.module'
import { AIModule } from './ai/ai.module'
import { CommunicationsModule } from './modules/communications/communications.module'
import { EmailModule } from './modules/email/email.module'
import { SuperAdminModule } from './modules/super-admin/super-admin.module'
import { PublicChatModule } from './modules/public-chat/public-chat.module'
import { PrismaModule } from './common/prisma/prisma.module'
import { CloudinaryModule } from './common/cloudinary/cloudinary.module'
import { FeatureFlagsModule } from './common/feature-flags/feature-flags.module'
import { QueueModule } from './queue/queue.module'
import { RealtimeModule } from './realtime/realtime.module'
import { IntegrationsModule } from './modules/integrations/integrations.module'
import { DocumentTemplatesModule } from './modules/document-templates/document-templates.module'
import { StormModule } from './modules/storm/storm.module'
import { TicketsModule } from './modules/tickets/tickets.module'
import { TicketProcessorModule } from './modules/tickets/ticket-processor.module'
import { ScheduleModule } from '@nestjs/schedule'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    CloudinaryModule,
    FeatureFlagsModule,
    QueueModule,
    RealtimeModule,
    AIModule,
    AuthModule,
    TenantsModule,
    AgentsModule,
    PublicChatModule,
    ChatModule,
    TasksModule,
    ApprovalsModule,
    KnowledgeModule,
    DocumentsModule,
    CrmModule,
    WebhooksModule,
    AnalyticsModule,
    AuditModule,
    BrainModule,
    CommunicationsModule,
    EmailModule,
    SuperAdminModule,
    IntegrationsModule,
    DocumentTemplatesModule,
    StormModule,
    TicketsModule,
    TicketProcessorModule,
  ],
})
export class AppModule {}
