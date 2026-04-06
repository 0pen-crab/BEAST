ALTER TABLE "findings" ADD COLUMN "category" varchar(32);
CREATE INDEX IF NOT EXISTS "idx_findings_category" ON "findings" ("category");
