-- EmailConversation: tracks full threads so replies always stay in the same chain

CREATE TABLE IF NOT EXISTS "EmailConversation" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "connectedAccountId" TEXT NOT NULL,
  "customerEmail"      TEXT NOT NULL,
  "customerName"       TEXT,
  "subject"            TEXT,
  "status"             TEXT NOT NULL DEFAULT 'open',
  "lastMessageId"      TEXT,
  "allMessageIds"      TEXT[] NOT NULL DEFAULT '{}',
  "assignedAgentId"    TEXT,
  "lastReplyAt"        TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailConversation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmailConversation_connectedAccountId_fkey"
    FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "EmailConversation_tenantId_customerEmail_idx"
  ON "EmailConversation"("tenantId", "customerEmail");

CREATE INDEX IF NOT EXISTS "EmailConversation_connectedAccountId_customerEmail_idx"
  ON "EmailConversation"("connectedAccountId", "customerEmail");

-- Add conversationId to ProcessedEmail
ALTER TABLE "ProcessedEmail"
  ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProcessedEmail_conversationId_fkey'
  ) THEN
    ALTER TABLE "ProcessedEmail"
      ADD CONSTRAINT "ProcessedEmail_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "EmailConversation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
