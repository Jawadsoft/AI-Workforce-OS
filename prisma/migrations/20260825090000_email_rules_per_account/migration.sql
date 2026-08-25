-- Migration: scope EmailAgentRule to per connected account
-- Drop old global unique constraint
DROP INDEX IF EXISTS "EmailAgentRule_tenantId_emailType_key";

-- Add connectedAccountId column (nullable first so existing rows don't break)
ALTER TABLE "EmailAgentRule" ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT;

-- Delete all existing global rules — they will be re-seeded per account on next load
DELETE FROM "EmailAgentRule" WHERE "connectedAccountId" IS NULL;

-- Now make the column NOT NULL
ALTER TABLE "EmailAgentRule" ALTER COLUMN "connectedAccountId" SET NOT NULL;

-- Add foreign key to ConnectedAccount
ALTER TABLE "EmailAgentRule"
  ADD CONSTRAINT "EmailAgentRule_connectedAccountId_fkey"
  FOREIGN KEY ("connectedAccountId")
  REFERENCES "ConnectedAccount"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Add new unique constraint: one rule per email type per account
CREATE UNIQUE INDEX "EmailAgentRule_connectedAccountId_emailType_key"
  ON "EmailAgentRule"("connectedAccountId", "emailType");
