import {
  pgTable,
  serial,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  real,
  smallint,
  bigint,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  unique,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── 1. workspaces ────────────────────────────────────────────

export const workspaces = pgTable('workspaces', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 256 }).unique().notNull(),
  description: text('description'),
  defaultLanguage: varchar('default_language', { length: 10 }).default('en'),
  aiAnalysisEnabled: boolean('ai_analysis_enabled').notNull().default(true),
  aiScanningEnabled: boolean('ai_scanning_enabled').notNull().default(true),
  aiTriageEnabled: boolean('ai_triage_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── 2. users ─────────────────────────────────────────────────

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 128 }).unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: varchar('display_name', { length: 256 }),
  role: varchar('role', { length: 32 }).default('user'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── 3. sessions ──────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 128 }).unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  index('idx_sessions_token').on(table.token),
  index('idx_sessions_expires').on(table.expiresAt),
]);

// ── 3b. workspace_members ───────────────────────────────────

export const workspaceMembers = pgTable('workspace_members', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 32 }).notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('workspace_members_user_workspace_unique').on(table.userId, table.workspaceId),
  index('idx_workspace_members_user').on(table.userId),
  index('idx_workspace_members_workspace').on(table.workspaceId),
]);

// ── 4. teams ─────────────────────────────────────────────────

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 256 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('teams_workspace_id_name_unique').on(table.workspaceId, table.name),
  index('idx_teams_workspace').on(table.workspaceId),
]);

// ── 5. sources (was git_integrations) ──────────────────────

export const sources = pgTable('sources', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(),
  baseUrl: text('base_url').notNull(),
  orgName: varchar('org_name', { length: 256 }),
  orgType: varchar('org_type', { length: 32 }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  syncIntervalMinutes: integer('sync_interval_minutes').default(1440),
  prCommentsEnabled: boolean('pr_comments_enabled').default(false),
  detectedScopes: text('detected_scopes').array().default(sql`'{}'`),
  webhookId: varchar('webhook_id', { length: 256 }),
  credentialType: varchar('credential_type', { length: 32 }),
  credentialUsername: varchar('credential_username', { length: 256 }),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_sources_workspace').on(table.workspaceId),
]);

// ── 6. source_app_installations (was git_app_installations) ─

export const sourceAppInstallations = pgTable('source_app_installations', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  installationId: varchar('installation_id', { length: 256 }).notNull(),
  permissions: jsonb('permissions').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_source_app_installations_source').on(table.sourceId),
]);

// ── 7. secrets (encrypted vault) ─────────────────────────────
export const secrets = pgTable('secrets', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 256 }).notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: varchar('iv', { length: 24 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_secrets_workspace').on(table.workspaceId),
]);

// ── 8. secret_refs (polymorphic join) ────────────────────────
export const secretRefs = pgTable('secret_refs', {
  id: serial('id').primaryKey(),
  secretId: integer('secret_id').notNull().references(() => secrets.id, { onDelete: 'cascade' }),
  ownerType: varchar('owner_type', { length: 64 }).notNull(),
  ownerId: integer('owner_id').notNull(),
  label: varchar('label', { length: 64 }).notNull(),
}, (table) => [
  index('idx_secret_refs_owner').on(table.ownerType, table.ownerId),
  uniqueIndex('uq_secret_refs_owner_label').on(table.ownerType, table.ownerId, table.label),
]);

// ── 8b. workspace_tools ──────────────────────────────────────
export const workspaceTools = pgTable('workspace_tools', {
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  toolKey: varchar('tool_key', { length: 64 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.toolKey] }),
]);

export type WorkspaceTool = typeof workspaceTools.$inferSelect;
export type NewWorkspaceTool = typeof workspaceTools.$inferInsert;

// ── 9. repositories ─────────────────────────────────────────

export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 256 }).notNull(),
  repoUrl: text('repo_url'),
  description: text('description'),
  lifecycle: varchar('lifecycle', { length: 32 }).default('active'),
  tags: text('tags').array().default(sql`'{}'`),
  status: varchar('status', { length: 32 }).default('pending'),
  externalId: varchar('external_id', { length: 256 }),
  sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  primaryLanguage: varchar('primary_language', { length: 64 }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('repositories_team_id_name_source_unique').on(table.teamId, table.name, table.sourceId),
  index('idx_repositories_team').on(table.teamId),
  index('idx_repositories_source_external').on(table.sourceId, table.externalId),
]);

// ── 9. scans (UUID PK) ─────────────────────────────────────

export const scans = pgTable('scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull().default('queued'),
  repoUrl: text('repo_url'),
  repoName: text('repo_name').notNull(),
  branch: text('branch'),
  commitHash: text('commit_hash'),
  localPath: text('local_path'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  repositoryId: integer('repository_id').references(() => repositories.id, { onDelete: 'set null' }),
  workspaceId: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  pullRequestId: integer('pull_request_id'),
  scanType: varchar('scan_type', { length: 16 }).default('full'),
}, (table) => [
  index('idx_scans_status').on(table.status),
  index('idx_scans_created').on(table.createdAt),
  index('idx_scans_repository').on(table.repositoryId),
  index('idx_scans_workspace').on(table.workspaceId),
]);

// ── 9b. scan_steps ──────────────────────────────────────────

export const scanSteps = pgTable('scan_steps', {
  id: serial('id').primaryKey(),
  scanId: uuid('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
  stepName: varchar('step_name', { length: 50 }).notNull(),
  stepOrder: smallint('step_order').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  input: jsonb('input').$type<Record<string, unknown>>(),
  output: jsonb('output').$type<Record<string, unknown>>(),
  error: text('error'),
  artifactsPath: varchar('artifacts_path', { length: 500 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_scan_steps_scan_id').on(table.scanId),
]);

// ── pull_requests ─────────────────────────────────────────
export const pullRequests = pgTable('pull_requests', {
  id: serial('id').primaryKey(),
  repositoryId: integer('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  externalId: integer('external_id').notNull(),
  title: varchar('title', { length: 512 }).notNull(),
  description: text('description'),
  author: varchar('author', { length: 256 }).notNull(),
  sourceBranch: varchar('source_branch', { length: 256 }).notNull(),
  targetBranch: varchar('target_branch', { length: 256 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('open'),
  prUrl: text('pr_url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_pull_requests_repository').on(table.repositoryId),
  index('idx_pull_requests_workspace').on(table.workspaceId),
  unique('pull_requests_repo_external_unique').on(table.repositoryId, table.externalId),
]);

// ── 10. scan_files ──────────────────────────────────────────

export const scanFiles = pgTable('scan_files', {
  id: serial('id').primaryKey(),
  scanId: uuid('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 256 }).notNull(),
  fileType: varchar('file_type', { length: 64 }),
  filePath: text('file_path'),
  content: text('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_scan_files_scan').on(table.scanId),
]);

// ── 11. scan_notes ──────────────────────────────────────────

export const scanNotes = pgTable('scan_notes', {
  id: serial('id').primaryKey(),
  scanId: uuid('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
  author: varchar('author', { length: 128 }).default('system'),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_scan_notes_scan').on(table.scanId),
]);

// ── 12. tests ───────────────────────────────────────────────

export const tests = pgTable('tests', {
  id: serial('id').primaryKey(),
  scanId: uuid('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
  tool: varchar('tool', { length: 64 }).notNull(),
  scanType: varchar('scan_type', { length: 128 }).notNull(),
  testTitle: varchar('test_title', { length: 256 }),
  fileName: varchar('file_name', { length: 256 }),
  findingsCount: integer('findings_count').default(0),
  importStatus: varchar('import_status', { length: 32 }).default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_tests_scan').on(table.scanId),
  index('idx_tests_tool').on(table.tool),
]);

// ── 13. findings ────────────────────────────────────────────

export const findings = pgTable('findings', {
  id: serial('id').primaryKey(),
  testId: integer('test_id').notNull().references(() => tests.id, { onDelete: 'cascade' }),
  repositoryId: integer('repository_id').references(() => repositories.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  severity: varchar('severity', { length: 16 }).notNull(),
  description: text('description'),
  filePath: text('file_path'),
  line: integer('line'),
  vulnIdFromTool: text('vuln_id_from_tool'),
  cwe: integer('cwe'),
  cvssScore: real('cvss_score'),
  tool: varchar('tool', { length: 64 }).notNull(),
  category: varchar('category', { length: 32 }),
  status: varchar('status', { length: 32 }).default('open'),
  riskAcceptedReason: text('risk_accepted_reason'),
  codeSnippet: text('code_snippet'),
  secretValue: text('secret_value'),
  fingerprint: varchar('fingerprint', { length: 128 }),
  duplicateOf: integer('duplicate_of').references((): any => findings.id),
  contributorId: integer('contributor_id').references(() => contributors.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_findings_test').on(table.testId),
  index('idx_findings_repository').on(table.repositoryId),
  index('idx_findings_fingerprint').on(table.fingerprint),
  index('idx_findings_severity').on(table.severity),
  index('idx_findings_status').on(table.status),
  index('idx_findings_contributor_id').on(table.contributorId),
  index('idx_findings_category').on(table.category),
]);

// ── 14. finding_notes ───────────────────────────────────────

export const findingNotes = pgTable('finding_notes', {
  id: serial('id').primaryKey(),
  findingId: integer('finding_id').notNull().references(() => findings.id, { onDelete: 'cascade' }),
  author: varchar('author', { length: 128 }).default('system'),
  noteType: varchar('note_type', { length: 32 }).default('comment'),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_finding_notes_finding').on(table.findingId),
]);

// ── 15. workspace_events ────────────────────────────────────

export const workspaceEvents = pgTable('workspace_events', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_workspace_events_workspace').on(table.workspaceId),
  index('idx_workspace_events_type').on(table.eventType),
]);

// ── 16. contributors ─────────────────────────────────────────

export const contributors = pgTable('contributors', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
  displayName: varchar('display_name', { length: 256 }).notNull(),
  emails: text('emails').array().notNull().default(sql`'{}'`),
  firstSeen: timestamp('first_seen', { withTimezone: true }),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  totalCommits: integer('total_commits').notNull().default(0),
  totalLocAdded: bigint('total_loc_added', { mode: 'number' }).notNull().default(0),
  totalLocRemoved: bigint('total_loc_removed', { mode: 'number' }).notNull().default(0),
  repoCount: integer('repo_count').notNull().default(0),
  scoreOverall: real('score_overall'),
  scoreSecurity: real('score_security'),
  scoreQuality: real('score_quality'),
  scorePatterns: real('score_patterns'),
  scoreTesting: real('score_testing'),
  scoreInnovation: real('score_innovation'),
  feedback: text('feedback'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_contributors_score').on(table.scoreOverall),
]);

// ── 17. contributor_repo_stats ───────────────────────────────

export const contributorRepoStats = pgTable('contributor_repo_stats', {
  id: serial('id').primaryKey(),
  contributorId: integer('contributor_id').notNull().references(() => contributors.id, { onDelete: 'cascade' }),
  repoName: varchar('repo_name', { length: 256 }).notNull(),
  repoUrl: text('repo_url'),
  workspaceId: integer('workspace_id'),
  commitCount: integer('commit_count').notNull().default(0),
  locAdded: bigint('loc_added', { mode: 'number' }).notNull().default(0),
  locRemoved: bigint('loc_removed', { mode: 'number' }).notNull().default(0),
  firstCommit: timestamp('first_commit', { withTimezone: true }),
  lastCommit: timestamp('last_commit', { withTimezone: true }),
  fileTypes: jsonb('file_types').$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('contributor_repo_stats_contributor_id_repo_name_unique').on(table.contributorId, table.repoName),
  index('idx_contrib_repo_stats_contrib').on(table.contributorId),
]);

// ── 18. contributor_daily_activity ───────────────────────────

export const contributorDailyActivity = pgTable('contributor_daily_activity', {
  id: serial('id').primaryKey(),
  contributorId: integer('contributor_id').notNull().references(() => contributors.id, { onDelete: 'cascade' }),
  repoName: varchar('repo_name', { length: 256 }).notNull(),
  activityDate: date('activity_date').notNull(),
  commitCount: integer('commit_count').notNull().default(0),
}, (table) => [
  unique('contributor_daily_activity_contrib_repo_date_unique').on(table.contributorId, table.repoName, table.activityDate),
  index('idx_contrib_daily_contrib').on(table.contributorId),
]);

// ── 19. contributor_assessments ──────────────────────────────

export const contributorAssessments = pgTable('contributor_assessments', {
  id: serial('id').primaryKey(),
  contributorId: integer('contributor_id').notNull().references(() => contributors.id, { onDelete: 'cascade' }),
  repoName: varchar('repo_name', { length: 256 }),
  executionId: varchar('execution_id', { length: 64 }),
  assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
  scoreSecurity: real('score_security'),
  scoreQuality: real('score_quality'),
  scorePatterns: real('score_patterns'),
  scoreTesting: real('score_testing'),
  scoreInnovation: real('score_innovation'),
  notes: text('notes'),
  feedback: text('feedback'),
  details: jsonb('details').$type<Record<string, unknown>>().default({}),
}, (table) => [
  index('idx_contrib_assessments_contrib').on(table.contributorId),
]);

// ── 20. scan_events ─────────────────────────────────────────

export const scanEvents = pgTable('scan_events', {
  id: serial('id').primaryKey(),
  scanId: uuid('scan_id').references(() => scans.id, { onDelete: 'cascade' }),
  stepName: varchar('step_name', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  level: varchar('level', { length: 16 }).notNull(),
  source: varchar('source', { length: 128 }).notNull(),
  message: text('message').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().default({}),
  repoName: varchar('repo_name', { length: 256 }),
  workspaceId: integer('workspace_id'),
  resolved: boolean('resolved').notNull().default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: varchar('resolved_by', { length: 128 }),
}, (table) => [
  index('idx_scan_events_scan_id').on(table.scanId),
  index('idx_scan_events_level').on(table.level),
  index('idx_scan_events_resolved').on(table.resolved),
  check('scan_events_level_check', sql`${table.level} IN ('info', 'warning', 'error')`),
]);

// ── Inferred types ──────────────────────────────────────────

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

export type SourceAppInstallation = typeof sourceAppInstallations.$inferSelect;
export type NewSourceAppInstallation = typeof sourceAppInstallations.$inferInsert;

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;

export type Scan = typeof scans.$inferSelect;
export type NewScan = typeof scans.$inferInsert;

export type ScanFile = typeof scanFiles.$inferSelect;
export type NewScanFile = typeof scanFiles.$inferInsert;

export type ScanNote = typeof scanNotes.$inferSelect;
export type NewScanNote = typeof scanNotes.$inferInsert;

export type Test = typeof tests.$inferSelect;
export type NewTest = typeof tests.$inferInsert;

export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;

export type FindingNote = typeof findingNotes.$inferSelect;
export type NewFindingNote = typeof findingNotes.$inferInsert;

export type WorkspaceEvent = typeof workspaceEvents.$inferSelect;
export type NewWorkspaceEvent = typeof workspaceEvents.$inferInsert;

export type Contributor = typeof contributors.$inferSelect;
export type NewContributor = typeof contributors.$inferInsert;

export type ContributorRepoStat = typeof contributorRepoStats.$inferSelect;
export type NewContributorRepoStat = typeof contributorRepoStats.$inferInsert;

export type ContributorDailyActivity = typeof contributorDailyActivity.$inferSelect;
export type NewContributorDailyActivity = typeof contributorDailyActivity.$inferInsert;

export type ContributorAssessment = typeof contributorAssessments.$inferSelect;
export type NewContributorAssessment = typeof contributorAssessments.$inferInsert;

export type ScanStep = typeof scanSteps.$inferSelect;
export type NewScanStep = typeof scanSteps.$inferInsert;

export type ScanEvent = typeof scanEvents.$inferSelect;
export type NewScanEvent = typeof scanEvents.$inferInsert;

export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;
export type SecretRef = typeof secretRefs.$inferSelect;
export type NewSecretRef = typeof secretRefs.$inferInsert;
