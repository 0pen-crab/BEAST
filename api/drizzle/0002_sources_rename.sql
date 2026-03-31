-- Drop old tables (already empty, created this session)
DROP TABLE IF EXISTS "git_app_installations" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "git_credentials" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "git_integrations" CASCADE;
--> statement-breakpoint
-- Remove old column from repositories
ALTER TABLE "repositories" DROP COLUMN IF EXISTS "git_integration_id";
--> statement-breakpoint
-- Create new sources table
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"base_url" text NOT NULL,
	"org_name" varchar(256),
	"org_type" varchar(32),
	"last_synced_at" timestamp with time zone,
	"sync_interval_minutes" integer DEFAULT 60,
	"pr_comments_enabled" boolean DEFAULT false,
	"detected_scopes" text[] DEFAULT '{}',
	"webhook_secret" varchar(256),
	"webhook_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "source_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"credential_type" varchar(32) NOT NULL,
	"username" varchar(256),
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "source_app_installations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"installation_id" varchar(256) NOT NULL,
	"webhook_secret" text,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
-- Add source_id to repositories
ALTER TABLE "repositories" ADD COLUMN "source_id" integer;
--> statement-breakpoint
-- Foreign keys
ALTER TABLE "sources" ADD CONSTRAINT "sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_app_installations" ADD CONSTRAINT "source_app_installations_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Indexes
CREATE INDEX "idx_sources_workspace" ON "sources" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_source_credentials_source" ON "source_credentials" USING btree ("source_id");
--> statement-breakpoint
CREATE INDEX "idx_source_app_installations_source" ON "source_app_installations" USING btree ("source_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_repositories_integration_external";
--> statement-breakpoint
CREATE INDEX "idx_repositories_source_external" ON "repositories" USING btree ("source_id", "external_id");
