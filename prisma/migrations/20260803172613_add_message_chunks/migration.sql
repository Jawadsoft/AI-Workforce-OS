-- Raw-message vector store: chunked + embedded copy of every chat message.
-- Fallback recall layer for content that falls outside the 40-message live
-- window and outside the conversation's frozen first-60-message summary.

CREATE TABLE IF NOT EXISTS "MessageChunk" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "agentId"        TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId"      TEXT NOT NULL,
    "subjectKey"     TEXT,
    "role"           TEXT NOT NULL,
    "chunkIndex"     INTEGER NOT NULL DEFAULT 0,
    "content"        TEXT NOT NULL,
    "embedding"      JSONB,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MessageChunk_tenantId_agentId_conversationId_idx"
  ON "MessageChunk"("tenantId", "agentId", "conversationId");

CREATE INDEX IF NOT EXISTS "MessageChunk_tenantId_agentId_subjectKey_idx"
  ON "MessageChunk"("tenantId", "agentId", "subjectKey");

CREATE INDEX IF NOT EXISTS "MessageChunk_messageId_idx"
  ON "MessageChunk"("messageId");

DO $$ BEGIN
  ALTER TABLE "MessageChunk"
    ADD CONSTRAINT "MessageChunk_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MessageChunk"
    ADD CONSTRAINT "MessageChunk_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
