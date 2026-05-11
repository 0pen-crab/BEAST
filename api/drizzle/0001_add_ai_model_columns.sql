ALTER TABLE workspaces ADD COLUMN ai_model_analyzer varchar(20) NOT NULL DEFAULT 'sonnet';
ALTER TABLE workspaces ADD COLUMN ai_model_scanner varchar(20) NOT NULL DEFAULT 'opus';
ALTER TABLE workspaces ADD COLUMN ai_model_triage varchar(20) NOT NULL DEFAULT 'opus';
