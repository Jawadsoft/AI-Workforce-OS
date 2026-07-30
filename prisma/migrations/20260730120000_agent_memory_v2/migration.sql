-- ChatGPT-like agent memory: running summary, multi-episode summaries, durable facts

-- Conversation: rolling in-thread summary always injected into the prompt
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "runningSummary" TEXT;

-- ConversationSummary: drop one-per-conversation unique so we can keep episode chunks
DROP INDEX IF EXISTS "ConversationSummary_conversationId_key";

ALTER TABLE "ConversationSummary" ADD COLUMN IF NOT EXISTS "subjectKey" TEXT;
ALTER TABLE "ConversationSummary" ADD COLUMN IF NOT EXISTS "importance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ConversationSummary" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ConversationSummary_tenantId_agentId_subjectKey_idx"
  ON "ConversationSummary"("tenantId", "agentId", "subjectKey");

-- Durable profile facts
CREATE TABLE IF NOT EXISTS "AgentMemoryFact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "embedding" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "sourceConversationId" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemoryFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentMemoryFact_tenantId_agentId_subjectKey_idx"
  ON "AgentMemoryFact"("tenantId", "agentId", "subjectKey");

CREATE INDEX IF NOT EXISTS "AgentMemoryFact_tenantId_agentId_deletedAt_idx"
  ON "AgentMemoryFact"("tenantId", "agentId", "deletedAt");

DO $$ BEGIN
  ALTER TABLE "AgentMemoryFact"
    ADD CONSTRAINT "AgentMemoryFact_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AgentMemoryFact"
    ADD CONSTRAINT "AgentMemoryFact_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
