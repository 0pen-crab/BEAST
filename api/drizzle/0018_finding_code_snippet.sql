-- Add code_snippet column to store source code context around the finding
ALTER TABLE findings ADD COLUMN IF NOT EXISTS code_snippet text;
