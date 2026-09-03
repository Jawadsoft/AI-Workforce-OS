-- Add layers JSON column to SocialPost for the visual image editor
ALTER TABLE "SocialPost" ADD COLUMN IF NOT EXISTS "layers" JSONB NOT NULL DEFAULT '{}';
