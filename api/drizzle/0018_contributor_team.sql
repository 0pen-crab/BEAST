ALTER TABLE contributors ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX idx_contributors_team ON contributors(team_id);
