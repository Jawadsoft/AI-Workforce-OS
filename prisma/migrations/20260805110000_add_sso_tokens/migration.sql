-- CreateTable
CREATE TABLE IF NOT EXISTS "SsoToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SsoToken_token_key" ON "SsoToken"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SsoToken_token_source_idx" ON "SsoToken"("token", "source");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SsoToken_userId_idx" ON "SsoToken"("userId");

-- AddForeignKey
ALTER TABLE "SsoToken" ADD CONSTRAINT "SsoToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
