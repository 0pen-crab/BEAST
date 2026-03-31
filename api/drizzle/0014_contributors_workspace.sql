ALTER TABLE contributors ADD COLUMN workspace_id integer REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX idx_contributors_workspace ON contributors(workspace_id);
