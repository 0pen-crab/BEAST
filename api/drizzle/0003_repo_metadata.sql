ALTER TABLE "repositories" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "primary_language" varchar(64);--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "last_activity_at" timestamp with time zone;
