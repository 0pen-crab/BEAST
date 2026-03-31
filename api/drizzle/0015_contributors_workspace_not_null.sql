-- Clean up orphan contributors with no workspace
DELETE FROM contributors WHERE workspace_id IS NULL;

-- Make workspace_id NOT NULL
ALTER TABLE contributors ALTER COLUMN workspace_id SET NOT NULL;
