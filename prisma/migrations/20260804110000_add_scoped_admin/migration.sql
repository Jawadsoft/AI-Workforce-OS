-- Add SCOPED_ADMIN to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SCOPED_ADMIN';

-- Add createdByAdminId column to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdByAdminId" TEXT;

-- Create SuperAdminTenantAccess table
CREATE TABLE IF NOT EXISTS "SuperAdminTenantAccess" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "SuperAdminTenantAccess_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'SuperAdminTenantAccess_adminUserId_tenantId_key'
    ) THEN
        ALTER TABLE "SuperAdminTenantAccess" ADD CONSTRAINT "SuperAdminTenantAccess_adminUserId_tenantId_key" UNIQUE ("adminUserId", "tenantId");
    END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "SuperAdminTenantAccess_adminUserId_idx" ON "SuperAdminTenantAccess"("adminUserId");
CREATE INDEX IF NOT EXISTS "SuperAdminTenantAccess_tenantId_idx" ON "SuperAdminTenantAccess"("tenantId");

-- Add foreign key constraints
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'SuperAdminTenantAccess_adminUserId_fkey'
    ) THEN
        ALTER TABLE "SuperAdminTenantAccess" ADD CONSTRAINT "SuperAdminTenantAccess_adminUserId_fkey" 
        FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'SuperAdminTenantAccess_tenantId_fkey'
    ) THEN
        ALTER TABLE "SuperAdminTenantAccess" ADD CONSTRAINT "SuperAdminTenantAccess_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'User_createdByAdminId_fkey'
    ) THEN
        ALTER TABLE "User" ADD CONSTRAINT "User_createdByAdminId_fkey" 
        FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
