-- AlterTable: add assignedAgentId to ConnectedAccount for per-account agent override
ALTER TABLE "ConnectedAccount" ADD COLUMN IF NOT EXISTS "assignedAgentId" TEXT;

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_assignedAgentId_fkey"
  FOREIGN KEY ("assignedAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
