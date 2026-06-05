/*
  Warnings:

  - You are about to drop the column `reviewerId` on the `Approval` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "TaskStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "TaskStatus" ADD VALUE 'CANCELLED';

-- DropForeignKey
ALTER TABLE "Approval" DROP CONSTRAINT "Approval_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "Approval" DROP CONSTRAINT "Approval_taskId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_agentId_fkey";

-- AlterTable
ALTER TABLE "Approval" DROP COLUMN "reviewerId",
ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "approverId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "title" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'general',
ALTER COLUMN "taskId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
ALTER COLUMN "agentId" DROP NOT NULL,
ALTER COLUMN "intent" SET DEFAULT 'general_task';

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
