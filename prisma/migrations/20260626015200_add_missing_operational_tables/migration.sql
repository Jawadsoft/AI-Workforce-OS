-- AlterEnum
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'HVAC';
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'LANDSCAPING';
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'PEST_CONTROL';
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'INSURANCE';
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'HUMAN_RESOURCES';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_AGENT', 'SCHEDULED', 'COMPLETED', 'ESCALATED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "isApproved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "htmlBody" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "accountName" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailAgentRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "emailType" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'notify_only',
    "replyTemplate" TEXT,
    "confidenceThreshold" INTEGER NOT NULL DEFAULT 80,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAgentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProcessedEmail" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectedAccountId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "threadId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "classification" TEXT,
    "confidence" INTEGER,
    "extractedData" JSONB NOT NULL DEFAULT '{}',
    "action" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "draftReplyId" TEXT,
    "approvalId" TEXT,
    "taskId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ActivityTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'INTERNAL',
    "conversationId" TEXT,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "type" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "contactRef" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "createdByAgentId" TEXT,
    "assignedAgentId" TEXT,
    "nextAction" TEXT,
    "followUpAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "searchEmbedding" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConversationSummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "conversationId" TEXT,
    "summaryType" TEXT NOT NULL DEFAULT 'CONVERSATION',
    "summary" TEXT NOT NULL,
    "keyEntities" TEXT[],
    "embedding" JSONB,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StormReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "time" TEXT,
    "state" TEXT NOT NULL,
    "county" TEXT,
    "location" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "size" DOUBLE PRECISION,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StormReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedAccount_tenantId_provider_accountEmail_key" ON "ConnectedAccount"("tenantId", "provider", "accountEmail");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmailAgentRule_tenantId_emailType_key" ON "EmailAgentRule"("tenantId", "emailType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessedEmail_connectedAccountId_gmailMessageId_key" ON "ProcessedEmail"("connectedAccountId", "gmailMessageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ActivityTicket_tenantId_status_idx" ON "ActivityTicket"("tenantId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ActivityTicket_tenantId_source_idx" ON "ActivityTicket"("tenantId", "source");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ActivityTicket_tenantId_assignedAgentId_idx" ON "ActivityTicket"("tenantId", "assignedAgentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ActivityTicket_tenantId_followUpAt_idx" ON "ActivityTicket"("tenantId", "followUpAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationSummary_conversationId_key" ON "ConversationSummary"("conversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConversationSummary_tenantId_agentId_createdAt_idx" ON "ConversationSummary"("tenantId", "agentId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StormReport_tenantId_reportDate_idx" ON "StormReport"("tenantId", "reportDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StormReport_tenantId_state_idx" ON "StormReport"("tenantId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StormReport_tenantId_type_reportDate_idx" ON "StormReport"("tenantId", "type", "reportDate");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "EmailAgentRule" ADD CONSTRAINT "EmailAgentRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "EmailAgentRule" ADD CONSTRAINT "EmailAgentRule_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ProcessedEmail" ADD CONSTRAINT "ProcessedEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ProcessedEmail" ADD CONSTRAINT "ProcessedEmail_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ActivityTicket" ADD CONSTRAINT "ActivityTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ActivityTicket" ADD CONSTRAINT "ActivityTicket_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ActivityTicket" ADD CONSTRAINT "ActivityTicket_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ActivityTicket" ADD CONSTRAINT "ActivityTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StormReport" ADD CONSTRAINT "StormReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
