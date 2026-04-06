ALTER TABLE "workspaces" ADD COLUMN "ai_analysis_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "workspaces" ADD COLUMN "ai_scanning_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "workspaces" ADD COLUMN "ai_triage_enabled" boolean NOT NULL DEFAULT true;
