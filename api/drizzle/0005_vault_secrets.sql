-- Vault: encrypted secrets storage
CREATE TABLE "secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer,
	"name" varchar(256) NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "secret_refs" (
	"id" serial PRIMARY KEY NOT NULL,
	"secret_id" integer NOT NULL,
	"owner_type" varchar(64) NOT NULL,
	"owner_id" integer NOT NULL,
	"label" varchar(64) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_refs" ADD CONSTRAINT "secret_refs_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_secrets_workspace" ON "secrets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_secret_refs_owner" ON "secret_refs" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_secret_refs_owner_label" ON "secret_refs" USING btree ("owner_type","owner_id","label");--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "jfrog_url" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "credential_type" varchar(32);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "credential_username" varchar(256);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN IF EXISTS "webhook_secret";--> statement-breakpoint
ALTER TABLE "source_app_installations" DROP COLUMN IF EXISTS "webhook_secret";--> statement-breakpoint
DROP TABLE IF EXISTS "source_credentials";
