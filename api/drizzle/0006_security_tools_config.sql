CREATE TABLE IF NOT EXISTS "workspace_tools" (
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "tool_key" varchar(64) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("workspace_id", "tool_key")
);

-- Migrate jfrogUrl values to vault before dropping
INSERT INTO "secrets" ("workspace_id", "name", "encrypted_value", "iv")
SELECT id, 'jfrog_url', jfrog_url, ''
FROM "workspaces"
WHERE jfrog_url IS NOT NULL AND jfrog_url != ''
ON CONFLICT DO NOTHING;

ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "jfrog_url";

-- Seed default tools for existing workspaces
INSERT INTO "workspace_tools" ("workspace_id", "tool_key", "enabled")
SELECT w.id, tool.key, true
FROM "workspaces" w
CROSS JOIN (VALUES ('gitleaks'), ('trufflehog'), ('trivy-secrets'), ('trivy-sca'), ('trivy-iac')) AS tool(key)
ON CONFLICT DO NOTHING;
