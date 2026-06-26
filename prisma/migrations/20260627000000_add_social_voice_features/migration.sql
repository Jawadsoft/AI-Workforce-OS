-- Add voiceId to Agent
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "voiceId" TEXT;

-- Add attachments to Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]';

-- CreateTable TenantFeatureFlag
CREATE TABLE IF NOT EXISTS "TenantFeatureFlag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "enabledBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable SocialAccount
CREATE TABLE IF NOT EXISTS "SocialAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "pageId" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable SocialPost
CREATE TABLE IF NOT EXISTS "SocialPost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT,
    "socialAccountId" TEXT,
    "platform" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imagePrompt" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "platformPostId" TEXT,
    "errorMessage" TEXT,
    "approvalId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TenantFeatureFlag_tenantId_feature_key" ON "TenantFeatureFlag"("tenantId", "feature");
CREATE INDEX IF NOT EXISTS "TenantFeatureFlag_tenantId_idx" ON "TenantFeatureFlag"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_tenantId_platform_key" ON "SocialAccount"("tenantId", "platform");
CREATE INDEX IF NOT EXISTS "SocialAccount_tenantId_idx" ON "SocialAccount"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SocialPost_tenantId_status_idx" ON "SocialPost"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "SocialPost_tenantId_platform_idx" ON "SocialPost"("tenantId", "platform");
CREATE INDEX IF NOT EXISTS "SocialPost_scheduledAt_idx" ON "SocialPost"("scheduledAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TenantFeatureFlag" ADD CONSTRAINT "TenantFeatureFlag_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_socialAccountId_fkey"
        FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
