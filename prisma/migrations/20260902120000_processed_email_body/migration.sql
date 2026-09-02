-- Add full email body storage to ProcessedEmail
-- Stored as cleaned plain text (MIME/HTML stripped) — max ~4000 chars per email
-- PostgreSQL TOAST handles out-of-line storage automatically for large values

ALTER TABLE "ProcessedEmail"
  ADD COLUMN IF NOT EXISTS "body" TEXT;
