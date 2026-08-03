-- Super-admin-editable Help Guide overrides + attached images (e.g. CRM screenshots)

CREATE TABLE IF NOT EXISTS "HelpArticleOverride" (
    "id"          TEXT NOT NULL,
    "articleId"   TEXT NOT NULL,
    "title"       TEXT,
    "category"    TEXT,
    "audience"    TEXT,
    "summary"     TEXT,
    "steps"       JSONB,
    "tips"        JSONB,
    "isCustom"    BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpArticleOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HelpArticleOverride_articleId_key"
  ON "HelpArticleOverride"("articleId");

CREATE TABLE IF NOT EXISTS "HelpArticleImage" (
    "id"        TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "url"       TEXT NOT NULL,
    "caption"   TEXT,
    "position"  INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpArticleImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HelpArticleImage_articleId_idx"
  ON "HelpArticleImage"("articleId");
