CREATE TABLE "pull_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"external_id" integer NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"author" varchar(256) NOT NULL,
	"source_branch" varchar(256) NOT NULL,
	"target_branch" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"pr_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "pull_requests_repo_external_unique" UNIQUE("repository_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "git_integrations" ADD COLUMN "pr_comments_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "git_integrations" ADD COLUMN "detected_scopes" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "git_integrations" ADD COLUMN "webhook_secret" varchar(256);--> statement-breakpoint
ALTER TABLE "git_integrations" ADD COLUMN "webhook_id" varchar(256);--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "pull_request_id" integer;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "scan_type" varchar(16) DEFAULT 'full';--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pull_requests_repository" ON "pull_requests" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "idx_pull_requests_workspace" ON "pull_requests" USING btree ("workspace_id");