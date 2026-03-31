CREATE TABLE "developer_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"developer_id" integer NOT NULL,
	"repo_name" varchar(256),
	"execution_id" varchar(64),
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score_security" real,
	"score_quality" real,
	"score_patterns" real,
	"score_testing" real,
	"score_innovation" real,
	"notes" text,
	"details" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "developer_daily_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"developer_id" integer NOT NULL,
	"activity_date" date NOT NULL,
	"commit_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "developer_daily_activity_developer_id_activity_date_unique" UNIQUE("developer_id","activity_date")
);
--> statement-breakpoint
CREATE TABLE "developer_repo_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"developer_id" integer NOT NULL,
	"repo_name" varchar(256) NOT NULL,
	"repo_url" text,
	"workspace_id" integer,
	"commit_count" integer DEFAULT 0 NOT NULL,
	"loc_added" bigint DEFAULT 0 NOT NULL,
	"loc_removed" bigint DEFAULT 0 NOT NULL,
	"first_commit" timestamp with time zone,
	"last_commit" timestamp with time zone,
	"file_types" jsonb DEFAULT '{}'::jsonb,
	"primary_areas" text[] DEFAULT '{}',
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developer_repo_stats_developer_id_repo_name_unique" UNIQUE("developer_id","repo_name")
);
--> statement-breakpoint
CREATE TABLE "developers" (
	"id" serial PRIMARY KEY NOT NULL,
	"display_name" varchar(256) NOT NULL,
	"emails" text[] DEFAULT '{}' NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"total_commits" integer DEFAULT 0 NOT NULL,
	"total_loc_added" bigint DEFAULT 0 NOT NULL,
	"total_loc_removed" bigint DEFAULT 0 NOT NULL,
	"repo_count" integer DEFAULT 0 NOT NULL,
	"score_overall" real,
	"score_security" real,
	"score_quality" real,
	"score_patterns" real,
	"score_testing" real,
	"score_innovation" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"author" varchar(128) DEFAULT 'system',
	"note_type" varchar(32) DEFAULT 'comment',
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer NOT NULL,
	"repository_id" integer,
	"title" text NOT NULL,
	"severity" varchar(16) NOT NULL,
	"description" text,
	"file_path" text,
	"line" integer,
	"vuln_id_from_tool" text,
	"cwe" integer,
	"cvss_score" real,
	"tool" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'active',
	"risk_accepted" boolean DEFAULT false,
	"risk_accepted_reason" text,
	"active" boolean DEFAULT true,
	"fingerprint" varchar(128),
	"duplicate" boolean DEFAULT false,
	"duplicate_of" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "git_app_installations" (
	"id" serial PRIMARY KEY NOT NULL,
	"integration_id" integer NOT NULL,
	"installation_id" varchar(256) NOT NULL,
	"webhook_secret" text,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "git_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"integration_id" integer NOT NULL,
	"credential_type" varchar(32) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "git_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"base_url" text NOT NULL,
	"org_name" varchar(256),
	"org_type" varchar(32),
	"last_synced_at" timestamp with time zone,
	"sync_interval_minutes" integer DEFAULT 60,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"repo_url" text,
	"description" text,
	"lifecycle" varchar(32) DEFAULT 'active',
	"tags" text[] DEFAULT '{}',
	"status" varchar(32) DEFAULT 'pending',
	"external_id" varchar(256),
	"git_integration_id" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "repositories_team_id_name_unique" UNIQUE("team_id","name")
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(16) NOT NULL,
	"source" varchar(128) NOT NULL,
	"message" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"repo_name" varchar(256),
	"workspace_id" integer,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar(128),
	CONSTRAINT "scan_events_level_check" CHECK ("scan_events"."level" IN ('info', 'warning', 'error'))
);
--> statement-breakpoint
CREATE TABLE "scan_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" uuid NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"file_type" varchar(64),
	"file_path" text,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scan_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" uuid NOT NULL,
	"author" varchar(128) DEFAULT 'system',
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"repo_url" text,
	"repo_name" text NOT NULL,
	"branch" text,
	"commit_hash" text,
	"local_path" text,
	"job_id" text,
	"current_step" text,
	"steps" jsonb DEFAULT '[]'::jsonb,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"repository_id" integer,
	"workspace_id" integer
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "teams_workspace_id_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" uuid NOT NULL,
	"tool" varchar(64) NOT NULL,
	"scan_type" varchar(128) NOT NULL,
	"test_title" varchar(256),
	"file_name" varchar(256),
	"findings_count" integer DEFAULT 0,
	"import_status" varchar(32) DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(128) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(256),
	"role" varchar(32) DEFAULT 'user',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "workspace_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text,
	"default_language" varchar(10) DEFAULT 'en',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "workspaces_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "developer_assessments" ADD CONSTRAINT "developer_assessments_developer_id_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_daily_activity" ADD CONSTRAINT "developer_daily_activity_developer_id_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_repo_stats" ADD CONSTRAINT "developer_repo_stats_developer_id_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_notes" ADD CONSTRAINT "finding_notes_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_duplicate_of_findings_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_app_installations" ADD CONSTRAINT "git_app_installations_integration_id_git_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."git_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_credentials" ADD CONSTRAINT "git_credentials_integration_id_git_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."git_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_integrations" ADD CONSTRAINT "git_integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_git_integration_id_git_integrations_id_fk" FOREIGN KEY ("git_integration_id") REFERENCES "public"."git_integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_files" ADD CONSTRAINT "scan_files_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_notes" ADD CONSTRAINT "scan_notes_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_events" ADD CONSTRAINT "workspace_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dev_assessments_dev" ON "developer_assessments" USING btree ("developer_id");--> statement-breakpoint
CREATE INDEX "idx_dev_daily_dev" ON "developer_daily_activity" USING btree ("developer_id");--> statement-breakpoint
CREATE INDEX "idx_dev_repo_stats_dev" ON "developer_repo_stats" USING btree ("developer_id");--> statement-breakpoint
CREATE INDEX "idx_developers_score" ON "developers" USING btree ("score_overall");--> statement-breakpoint
CREATE INDEX "idx_finding_notes_finding" ON "finding_notes" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "idx_findings_test" ON "findings" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "idx_findings_repository" ON "findings" USING btree ("repository_id","active");--> statement-breakpoint
CREATE INDEX "idx_findings_fingerprint" ON "findings" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_findings_severity" ON "findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_findings_status" ON "findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_git_app_installations_integration" ON "git_app_installations" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "idx_git_credentials_integration" ON "git_credentials" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "idx_git_integrations_workspace" ON "git_integrations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_repositories_team" ON "repositories" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_repositories_integration_external" ON "repositories" USING btree ("git_integration_id","external_id");--> statement-breakpoint
CREATE INDEX "idx_scan_events_execution" ON "scan_events" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_scan_events_level" ON "scan_events" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_scan_events_resolved" ON "scan_events" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "idx_scan_files_scan" ON "scan_files" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "idx_scan_notes_scan" ON "scan_notes" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "idx_scans_status" ON "scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_scans_created" ON "scans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_scans_repository" ON "scans" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "idx_scans_workspace" ON "scans" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_token" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_teams_workspace" ON "teams" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_tests_scan" ON "tests" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "idx_tests_tool" ON "tests" USING btree ("tool");--> statement-breakpoint
CREATE INDEX "idx_workspace_events_workspace" ON "workspace_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_events_type" ON "workspace_events" USING btree ("event_type");