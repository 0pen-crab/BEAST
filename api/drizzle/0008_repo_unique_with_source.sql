-- Drop old unique constraint and add new one that includes source_id
ALTER TABLE "repositories" DROP CONSTRAINT IF EXISTS "repositories_team_id_name_unique";
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_team_id_name_source_unique" UNIQUE ("team_id", "name", "source_id");
