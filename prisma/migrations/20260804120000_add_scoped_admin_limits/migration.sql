-- Add maxTenants column to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "maxTenants" INTEGER DEFAULT 5;

-- Add permissions column to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
