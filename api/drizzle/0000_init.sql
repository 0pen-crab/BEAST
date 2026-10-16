CREATE TABLE contributor_assessments (
    id integer NOT NULL,
    contributor_id integer NOT NULL,
    repo_name character varying(256),
    execution_id character varying(64),
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    score_security real,
    score_quality real,
    score_patterns real,
    score_testing real,
    score_innovation real,
    notes text,
    details jsonb DEFAULT '{}'::jsonb,
    feedback text
);
CREATE TABLE contributor_daily_activity (
    id integer NOT NULL,
    contributor_id integer NOT NULL,
    activity_date date NOT NULL,
    commit_count integer DEFAULT 0 NOT NULL,
    repo_name character varying(256) NOT NULL
);
CREATE TABLE contributor_repo_stats (
    id integer NOT NULL,
    contributor_id integer NOT NULL,
    repo_name character varying(256) NOT NULL,
    repo_url text,
    workspace_id integer,
    commit_count integer DEFAULT 0 NOT NULL,
    loc_added bigint DEFAULT 0 NOT NULL,
    loc_removed bigint DEFAULT 0 NOT NULL,
    first_commit timestamp with time zone,
    last_commit timestamp with time zone,
    file_types jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE contributors (
    id integer NOT NULL,
    display_name character varying(256) NOT NULL,
    emails text[] DEFAULT '{}'::text[] NOT NULL,
    first_seen timestamp with time zone,
    last_seen timestamp with time zone,
    total_commits integer DEFAULT 0 NOT NULL,
    total_loc_added bigint DEFAULT 0 NOT NULL,
    total_loc_removed bigint DEFAULT 0 NOT NULL,
    repo_count integer DEFAULT 0 NOT NULL,
    score_overall real,
    score_security real,
    score_quality real,
    score_patterns real,
    score_testing real,
    score_innovation real,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    feedback text,
    workspace_id integer NOT NULL,
    team_id integer
);
CREATE SEQUENCE developer_assessments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE developer_assessments_id_seq OWNED BY contributor_assessments.id;
CREATE SEQUENCE developer_daily_activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE developer_daily_activity_id_seq OWNED BY contributor_daily_activity.id;
CREATE SEQUENCE developer_repo_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE developer_repo_stats_id_seq OWNED BY contributor_repo_stats.id;
CREATE SEQUENCE developers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE developers_id_seq OWNED BY contributors.id;
CREATE TABLE finding_notes (
    id integer NOT NULL,
    finding_id integer NOT NULL,
    author character varying(128) DEFAULT 'system'::character varying,
    note_type character varying(32) DEFAULT 'comment'::character varying,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE finding_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE finding_notes_id_seq OWNED BY finding_notes.id;
CREATE TABLE findings (
    id integer NOT NULL,
    test_id integer NOT NULL,
    repository_id integer,
    title text NOT NULL,
    severity character varying(16) NOT NULL,
    description text,
    file_path text,
    line integer,
    vuln_id_from_tool text,
    cwe integer,
    cvss_score real,
    tool character varying(64) NOT NULL,
    status character varying(32) DEFAULT 'open'::character varying,
    risk_accepted_reason text,
    fingerprint character varying(128),
    duplicate_of integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    contributor_id integer,
    code_snippet text,
    category character varying(32),
    secret_value text,
    CONSTRAINT chk_findings_severity CHECK (((severity)::text = ANY ((ARRAY['Critical'::character varying, 'High'::character varying, 'Medium'::character varying, 'Low'::character varying, 'Info'::character varying])::text[]))),
    CONSTRAINT chk_findings_status CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'false_positive'::character varying, 'fixed'::character varying, 'risk_accepted'::character varying, 'duplicate'::character varying])::text[])))
);
CREATE SEQUENCE findings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE findings_id_seq OWNED BY findings.id;
CREATE TABLE pull_requests (
    id integer NOT NULL,
    repository_id integer NOT NULL,
    workspace_id integer NOT NULL,
    external_id integer NOT NULL,
    title character varying(512) NOT NULL,
    description text,
    author character varying(256) NOT NULL,
    source_branch character varying(256) NOT NULL,
    target_branch character varying(256) NOT NULL,
    status character varying(32) DEFAULT 'open'::character varying NOT NULL,
    pr_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE pull_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE pull_requests_id_seq OWNED BY pull_requests.id;
CREATE TABLE repositories (
    id integer NOT NULL,
    team_id integer NOT NULL,
    name character varying(256) NOT NULL,
    repo_url text,
    description text,
    lifecycle character varying(32) DEFAULT 'active'::character varying,
    tags text[] DEFAULT '{}'::text[],
    status character varying(32) DEFAULT 'pending'::character varying,
    external_id character varying(256),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source_id integer,
    size_bytes bigint,
    primary_language character varying(64),
    last_activity_at timestamp with time zone
);
CREATE SEQUENCE repositories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE repositories_id_seq OWNED BY repositories.id;
CREATE TABLE scan_events (
    id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    level character varying(16) NOT NULL,
    source character varying(128) NOT NULL,
    message text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    repo_name character varying(256),
    workspace_id integer,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by character varying(128),
    scan_id uuid,
    step_name character varying(50),
    CONSTRAINT scan_events_level_check CHECK (((level)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'error'::character varying])::text[])))
);
CREATE SEQUENCE scan_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE scan_events_id_seq OWNED BY scan_events.id;
CREATE TABLE scan_files (
    id integer NOT NULL,
    scan_id uuid NOT NULL,
    file_name character varying(256) NOT NULL,
    file_type character varying(64),
    file_path text,
    content text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE scan_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE scan_files_id_seq OWNED BY scan_files.id;
CREATE TABLE scan_notes (
    id integer NOT NULL,
    scan_id uuid NOT NULL,
    author character varying(128) DEFAULT 'system'::character varying,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE scan_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE scan_notes_id_seq OWNED BY scan_notes.id;
CREATE TABLE scan_steps (
    id integer NOT NULL,
    scan_id uuid NOT NULL,
    step_name character varying(50) NOT NULL,
    step_order smallint NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    input jsonb,
    output jsonb,
    error text,
    artifacts_path character varying(500),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE scan_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE scan_steps_id_seq OWNED BY scan_steps.id;
CREATE TABLE scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    repo_url text,
    repo_name text NOT NULL,
    branch text,
    commit_hash text,
    local_path text,
    error text,
    metadata jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    repository_id integer,
    workspace_id integer,
    pull_request_id integer,
    scan_type character varying(16) DEFAULT 'full'::character varying,
    duration_ms integer
);
CREATE TABLE secret_refs (
    id integer NOT NULL,
    secret_id integer NOT NULL,
    owner_type character varying(64) NOT NULL,
    owner_id integer NOT NULL,
    label character varying(64) NOT NULL
);
CREATE SEQUENCE secret_refs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE secret_refs_id_seq OWNED BY secret_refs.id;
CREATE TABLE secrets (
    id integer NOT NULL,
    workspace_id integer,
    name character varying(256) NOT NULL,
    encrypted_value text NOT NULL,
    iv character varying(24) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE secrets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE secrets_id_seq OWNED BY secrets.id;
CREATE TABLE sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token character varying(128) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL
);
CREATE SEQUENCE sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE sessions_id_seq OWNED BY sessions.id;
CREATE TABLE source_app_installations (
    id integer NOT NULL,
    source_id integer NOT NULL,
    installation_id character varying(256) NOT NULL,
    permissions jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE source_app_installations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE source_app_installations_id_seq OWNED BY source_app_installations.id;
CREATE TABLE sources (
    id integer NOT NULL,
    workspace_id integer NOT NULL,
    provider character varying(32) NOT NULL,
    base_url text NOT NULL,
    org_name character varying(256),
    org_type character varying(32),
    last_synced_at timestamp with time zone,
    sync_interval_minutes integer DEFAULT 60,
    pr_comments_enabled boolean DEFAULT false,
    detected_scopes text[] DEFAULT '{}'::text[],
    webhook_id character varying(256),
    created_at timestamp with time zone DEFAULT now(),
    credential_type character varying(32),
    credential_username character varying(256),
    token_expires_at timestamp with time zone
);
CREATE SEQUENCE sources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE sources_id_seq OWNED BY sources.id;
CREATE TABLE teams (
    id integer NOT NULL,
    workspace_id integer NOT NULL,
    name character varying(256) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE teams_id_seq OWNED BY teams.id;
CREATE TABLE tests (
    id integer NOT NULL,
    scan_id uuid NOT NULL,
    tool character varying(64) NOT NULL,
    scan_type character varying(128) NOT NULL,
    test_title character varying(256),
    file_name character varying(256),
    findings_count integer DEFAULT 0,
    import_status character varying(32) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE tests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE tests_id_seq OWNED BY tests.id;
CREATE TABLE users (
    id integer NOT NULL,
    username character varying(128) NOT NULL,
    password_hash text NOT NULL,
    display_name character varying(256),
    role character varying(32) DEFAULT 'user'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    must_change_password boolean DEFAULT false NOT NULL
);
CREATE SEQUENCE users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE users_id_seq OWNED BY users.id;
CREATE TABLE workspace_events (
    id integer NOT NULL,
    workspace_id integer NOT NULL,
    event_type character varying(64) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE workspace_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE workspace_events_id_seq OWNED BY workspace_events.id;
CREATE TABLE workspace_members (
    id integer NOT NULL,
    user_id integer NOT NULL,
    workspace_id integer NOT NULL,
    role character varying(32) DEFAULT 'member'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE workspace_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE workspace_members_id_seq OWNED BY workspace_members.id;
CREATE TABLE workspace_tools (
    workspace_id integer NOT NULL,
    tool_key character varying(64) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE workspaces (
    id integer NOT NULL,
    name character varying(256) NOT NULL,
    description text,
    default_language character varying(10) DEFAULT 'en'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    ai_analysis_enabled boolean DEFAULT true NOT NULL,
    ai_scanning_enabled boolean DEFAULT true NOT NULL,
    ai_triage_enabled boolean DEFAULT true NOT NULL
);
CREATE SEQUENCE workspaces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE workspaces_id_seq OWNED BY workspaces.id;
ALTER TABLE ONLY contributor_assessments ALTER COLUMN id SET DEFAULT nextval('developer_assessments_id_seq'::regclass);
ALTER TABLE ONLY contributor_daily_activity ALTER COLUMN id SET DEFAULT nextval('developer_daily_activity_id_seq'::regclass);
ALTER TABLE ONLY contributor_repo_stats ALTER COLUMN id SET DEFAULT nextval('developer_repo_stats_id_seq'::regclass);
ALTER TABLE ONLY contributors ALTER COLUMN id SET DEFAULT nextval('developers_id_seq'::regclass);
ALTER TABLE ONLY finding_notes ALTER COLUMN id SET DEFAULT nextval('finding_notes_id_seq'::regclass);
ALTER TABLE ONLY findings ALTER COLUMN id SET DEFAULT nextval('findings_id_seq'::regclass);
ALTER TABLE ONLY pull_requests ALTER COLUMN id SET DEFAULT nextval('pull_requests_id_seq'::regclass);
ALTER TABLE ONLY repositories ALTER COLUMN id SET DEFAULT nextval('repositories_id_seq'::regclass);
ALTER TABLE ONLY scan_events ALTER COLUMN id SET DEFAULT nextval('scan_events_id_seq'::regclass);
ALTER TABLE ONLY scan_files ALTER COLUMN id SET DEFAULT nextval('scan_files_id_seq'::regclass);
ALTER TABLE ONLY scan_notes ALTER COLUMN id SET DEFAULT nextval('scan_notes_id_seq'::regclass);
ALTER TABLE ONLY scan_steps ALTER COLUMN id SET DEFAULT nextval('scan_steps_id_seq'::regclass);
ALTER TABLE ONLY secret_refs ALTER COLUMN id SET DEFAULT nextval('secret_refs_id_seq'::regclass);
ALTER TABLE ONLY secrets ALTER COLUMN id SET DEFAULT nextval('secrets_id_seq'::regclass);
ALTER TABLE ONLY sessions ALTER COLUMN id SET DEFAULT nextval('sessions_id_seq'::regclass);
ALTER TABLE ONLY source_app_installations ALTER COLUMN id SET DEFAULT nextval('source_app_installations_id_seq'::regclass);
ALTER TABLE ONLY sources ALTER COLUMN id SET DEFAULT nextval('sources_id_seq'::regclass);
ALTER TABLE ONLY teams ALTER COLUMN id SET DEFAULT nextval('teams_id_seq'::regclass);
ALTER TABLE ONLY tests ALTER COLUMN id SET DEFAULT nextval('tests_id_seq'::regclass);
ALTER TABLE ONLY users ALTER COLUMN id SET DEFAULT nextval('users_id_seq'::regclass);
ALTER TABLE ONLY workspace_events ALTER COLUMN id SET DEFAULT nextval('workspace_events_id_seq'::regclass);
ALTER TABLE ONLY workspace_members ALTER COLUMN id SET DEFAULT nextval('workspace_members_id_seq'::regclass);
ALTER TABLE ONLY workspaces ALTER COLUMN id SET DEFAULT nextval('workspaces_id_seq'::regclass);
ALTER TABLE ONLY contributor_daily_activity
    ADD CONSTRAINT contributor_daily_activity_contrib_repo_date_unique UNIQUE (contributor_id, repo_name, activity_date);
ALTER TABLE ONLY contributor_repo_stats
    ADD CONSTRAINT contributor_repo_stats_contributor_id_repo_name_unique UNIQUE (contributor_id, repo_name);
ALTER TABLE ONLY contributor_assessments
    ADD CONSTRAINT developer_assessments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY contributor_daily_activity
    ADD CONSTRAINT developer_daily_activity_pkey PRIMARY KEY (id);
ALTER TABLE ONLY contributor_repo_stats
    ADD CONSTRAINT developer_repo_stats_pkey PRIMARY KEY (id);
ALTER TABLE ONLY contributors
    ADD CONSTRAINT developers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY finding_notes
    ADD CONSTRAINT finding_notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY findings
    ADD CONSTRAINT findings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY pull_requests
    ADD CONSTRAINT pull_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY pull_requests
    ADD CONSTRAINT pull_requests_repo_external_unique UNIQUE (repository_id, external_id);
ALTER TABLE ONLY repositories
    ADD CONSTRAINT repositories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY repositories
    ADD CONSTRAINT repositories_team_id_name_source_unique UNIQUE (team_id, name, source_id);
ALTER TABLE ONLY scan_events
    ADD CONSTRAINT scan_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY scan_files
    ADD CONSTRAINT scan_files_pkey PRIMARY KEY (id);
ALTER TABLE ONLY scan_notes
    ADD CONSTRAINT scan_notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY scan_steps
    ADD CONSTRAINT scan_steps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY scans
    ADD CONSTRAINT scans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY secret_refs
    ADD CONSTRAINT secret_refs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY secrets
    ADD CONSTRAINT secrets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY sessions
    ADD CONSTRAINT sessions_token_unique UNIQUE (token);
ALTER TABLE ONLY source_app_installations
    ADD CONSTRAINT source_app_installations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);
ALTER TABLE ONLY teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
ALTER TABLE ONLY teams
    ADD CONSTRAINT teams_workspace_id_name_unique UNIQUE (workspace_id, name);
ALTER TABLE ONLY tests
    ADD CONSTRAINT tests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY users
    ADD CONSTRAINT users_username_unique UNIQUE (username);
ALTER TABLE ONLY workspace_events
    ADD CONSTRAINT workspace_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);
ALTER TABLE ONLY workspace_members
    ADD CONSTRAINT workspace_members_user_id_workspace_id_key UNIQUE (user_id, workspace_id);
ALTER TABLE ONLY workspace_tools
    ADD CONSTRAINT workspace_tools_pkey PRIMARY KEY (workspace_id, tool_key);
ALTER TABLE ONLY workspaces
    ADD CONSTRAINT workspaces_name_unique UNIQUE (name);
ALTER TABLE ONLY workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);
CREATE INDEX idx_contrib_assessments_contrib ON contributor_assessments USING btree (contributor_id);
CREATE INDEX idx_contrib_daily_contrib ON contributor_daily_activity USING btree (contributor_id);
CREATE INDEX idx_contrib_repo_stats_contrib ON contributor_repo_stats USING btree (contributor_id);
CREATE INDEX idx_contributors_score ON contributors USING btree (score_overall);
CREATE INDEX idx_contributors_team ON contributors USING btree (team_id);
CREATE INDEX idx_contributors_workspace ON contributors USING btree (workspace_id);
CREATE INDEX idx_finding_notes_finding ON finding_notes USING btree (finding_id);
CREATE INDEX idx_findings_category ON findings USING btree (category);
CREATE INDEX idx_findings_contributor_id ON findings USING btree (contributor_id);
CREATE INDEX idx_findings_fingerprint ON findings USING btree (fingerprint);
CREATE INDEX idx_findings_repository ON findings USING btree (repository_id);
CREATE INDEX idx_findings_severity ON findings USING btree (severity);
CREATE INDEX idx_findings_status ON findings USING btree (status);
CREATE INDEX idx_findings_test ON findings USING btree (test_id);
CREATE INDEX idx_pull_requests_repository ON pull_requests USING btree (repository_id);
CREATE INDEX idx_pull_requests_workspace ON pull_requests USING btree (workspace_id);
CREATE INDEX idx_repositories_source_external ON repositories USING btree (source_id, external_id);
CREATE INDEX idx_repositories_team ON repositories USING btree (team_id);
CREATE INDEX idx_scan_events_level ON scan_events USING btree (level);
CREATE INDEX idx_scan_events_resolved ON scan_events USING btree (resolved);
CREATE INDEX idx_scan_events_scan_id ON scan_events USING btree (scan_id);
CREATE INDEX idx_scan_files_scan ON scan_files USING btree (scan_id);
CREATE INDEX idx_scan_notes_scan ON scan_notes USING btree (scan_id);
CREATE INDEX idx_scan_steps_scan_id ON scan_steps USING btree (scan_id);
CREATE INDEX idx_scans_created ON scans USING btree (created_at);
CREATE INDEX idx_scans_repository ON scans USING btree (repository_id);
CREATE INDEX idx_scans_status ON scans USING btree (status);
CREATE INDEX idx_scans_workspace ON scans USING btree (workspace_id);
CREATE INDEX idx_secret_refs_owner ON secret_refs USING btree (owner_type, owner_id);
CREATE INDEX idx_secrets_workspace ON secrets USING btree (workspace_id);
CREATE INDEX idx_sessions_expires ON sessions USING btree (expires_at);
CREATE INDEX idx_sessions_token ON sessions USING btree (token);
CREATE INDEX idx_source_app_installations_source ON source_app_installations USING btree (source_id);
CREATE INDEX idx_sources_workspace ON sources USING btree (workspace_id);
CREATE INDEX idx_teams_workspace ON teams USING btree (workspace_id);
CREATE INDEX idx_tests_scan ON tests USING btree (scan_id);
CREATE INDEX idx_tests_tool ON tests USING btree (tool);
CREATE INDEX idx_workspace_events_type ON workspace_events USING btree (event_type);
CREATE INDEX idx_workspace_events_workspace ON workspace_events USING btree (workspace_id);
CREATE INDEX idx_workspace_members_user ON workspace_members USING btree (user_id);
CREATE INDEX idx_workspace_members_workspace ON workspace_members USING btree (workspace_id);
CREATE UNIQUE INDEX uq_secret_refs_owner_label ON secret_refs USING btree (owner_type, owner_id, label);
ALTER TABLE ONLY contributors
    ADD CONSTRAINT contributors_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE ONLY contributors
    ADD CONSTRAINT contributors_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY contributor_assessments
    ADD CONSTRAINT developer_assessments_developer_id_developers_id_fk FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE CASCADE;
ALTER TABLE ONLY contributor_daily_activity
    ADD CONSTRAINT developer_daily_activity_developer_id_developers_id_fk FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE CASCADE;
ALTER TABLE ONLY contributor_repo_stats
    ADD CONSTRAINT developer_repo_stats_developer_id_developers_id_fk FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE CASCADE;
ALTER TABLE ONLY finding_notes
    ADD CONSTRAINT finding_notes_finding_id_findings_id_fk FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE CASCADE;
ALTER TABLE ONLY findings
    ADD CONSTRAINT findings_contributor_id_fkey FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;
ALTER TABLE ONLY findings
    ADD CONSTRAINT findings_duplicate_of_findings_id_fk FOREIGN KEY (duplicate_of) REFERENCES findings(id);
ALTER TABLE ONLY findings
    ADD CONSTRAINT findings_repository_id_repositories_id_fk FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
ALTER TABLE ONLY findings
    ADD CONSTRAINT findings_test_id_tests_id_fk FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE;
ALTER TABLE ONLY scan_events
    ADD CONSTRAINT fk_scan_events_scan_id FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE;
ALTER TABLE ONLY pull_requests
    ADD CONSTRAINT pull_requests_repository_id_repositories_id_fk FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
ALTER TABLE ONLY pull_requests
    ADD CONSTRAINT pull_requests_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY repositories
    ADD CONSTRAINT repositories_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE ONLY repositories
    ADD CONSTRAINT repositories_team_id_teams_id_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE ONLY scan_files
    ADD CONSTRAINT scan_files_scan_id_scans_id_fk FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE;
ALTER TABLE ONLY scan_notes
    ADD CONSTRAINT scan_notes_scan_id_scans_id_fk FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE;
ALTER TABLE ONLY scan_steps
    ADD CONSTRAINT scan_steps_scan_id_fkey FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE;
ALTER TABLE ONLY scans
    ADD CONSTRAINT scans_repository_id_repositories_id_fk FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE SET NULL;
ALTER TABLE ONLY scans
    ADD CONSTRAINT scans_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY secret_refs
    ADD CONSTRAINT secret_refs_secret_id_secrets_id_fk FOREIGN KEY (secret_id) REFERENCES secrets(id) ON DELETE CASCADE;
ALTER TABLE ONLY secrets
    ADD CONSTRAINT secrets_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY source_app_installations
    ADD CONSTRAINT source_app_installations_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE;
ALTER TABLE ONLY sources
    ADD CONSTRAINT sources_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY teams
    ADD CONSTRAINT teams_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY tests
    ADD CONSTRAINT tests_scan_id_scans_id_fk FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE;
ALTER TABLE ONLY workspace_events
    ADD CONSTRAINT workspace_events_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY workspace_tools
    ADD CONSTRAINT workspace_tools_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
