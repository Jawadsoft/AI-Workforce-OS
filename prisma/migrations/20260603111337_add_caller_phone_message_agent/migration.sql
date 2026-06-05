-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "callerEmail" TEXT,
ADD COLUMN     "callerPhone" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "agentId" TEXT;
