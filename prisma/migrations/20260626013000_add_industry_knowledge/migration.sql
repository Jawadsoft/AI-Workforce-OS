-- CreateTable
CREATE TABLE "IndustryKnowledgePack" (
    "id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndustryKnowledgePack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryKnowledgeDoc" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "agentRoles" TEXT[],
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryKnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB,
    "chunkIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndustryKnowledgePack_industry_key" ON "IndustryKnowledgePack"("industry");

-- AddForeignKey
ALTER TABLE "IndustryKnowledgeDoc" ADD CONSTRAINT "IndustryKnowledgeDoc_packId_fkey" FOREIGN KEY ("packId") REFERENCES "IndustryKnowledgePack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndustryKnowledgeChunk" ADD CONSTRAINT "IndustryKnowledgeChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "IndustryKnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
