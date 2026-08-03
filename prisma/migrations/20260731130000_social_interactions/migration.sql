-- Inbound social comments/DMs + auto-reply tracking (idempotency + visibility)

CREATE TABLE IF NOT EXISTS "SocialInteraction" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "agentId"         TEXT,
    "platform"        TEXT NOT NULL,
    "type"            TEXT NOT NULL,
    "externalId"      TEXT NOT NULL,
    "parentId"        TEXT,
    "senderId"        TEXT,
    "senderName"      TEXT,
    "content"         TEXT NOT NULL,
    "replyContent"    TEXT,
    "status"          TEXT NOT NULL DEFAULT 'received',
    "errorMessage"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repliedAt"       TIMESTAMP(3),

    CONSTRAINT "SocialInteraction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialInteraction_platform_externalId_key"
  ON "SocialInteraction"("platform", "externalId");

CREATE INDEX IF NOT EXISTS "SocialInteraction_tenantId_createdAt_idx"
  ON "SocialInteraction"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "SocialInteraction_socialAccountId_idx"
  ON "SocialInteraction"("socialAccountId");

DO $$ BEGIN
  ALTER TABLE "SocialInteraction"
    ADD CONSTRAINT "SocialInteraction_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SocialInteraction"
    ADD CONSTRAINT "SocialInteraction_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
