// BEAST-native types matching the database schema

export interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

export interface Team {
  id: number;
  workspaceId: number;
  name: string;
  description: string | null;
  createdAt: string;
  // Computed fields from GET /api/teams
  repoCount?: number;
  contributorCount?: number;
  findingsCount?: number;
  avgRiskScore?: number;
}

export interface Repository {
  id: number;
  teamId: number;
  name: string;
  repoUrl: string | null;
  description: string | null;
  lifecycle: string;
  tags: string[];
  status: string;
  externalId: string | null;
  sourceId: number | null;
  sizeBytes: number | null;
  primaryLanguage: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined fields from GET /api/repositories
  teamName?: string;
  workspaceId?: number;
  findingsCount?: number;
  riskScore?: number;
  lastScannedAt?: string | null;
}

export interface Test {
  id: number;
  scanId: string;
  tool: string;
  scanType: string;
  testTitle: string | null;
  fileName: string | null;
  findingsCount: number;
  importStatus: string;
  createdAt: string;
}

export interface Finding {
  id: number;
  testId: number;
  repositoryId: number | null;
  title: string;
  severity: Severity;
  description: string | null;
  filePath: string | null;
  line: number | null;
  vulnIdFromTool: string | null;
  cwe: number | null;
  cvssScore: number | null;
  tool: string;
  category: string | null;
  status: string;
  codeSnippet: string | null;
  secretValue: string | null;
  riskAcceptedReason: string | null;
  fingerprint: string | null;
  duplicateOf: number | null;
  duplicateOfFinding?: {
    id: number;
    title: string;
    tool: string;
    filePath: string | null;
    line: number | null;
    severity: Severity;
  };
  createdAt: string;
  updatedAt: string;
  contributorId: number | null;
  contributorName: string | null;
  repositoryName: string | null;
  scanId: string;
  duplicateCount?: number;
}

export interface FindingDuplicate {
  id: number;
  tool: string;
  title: string;
  severity: Severity;
  filePath: string | null;
  line: number | null;
  codeSnippet: string | null;
  secretValue: string | null;
  category: string | null;
  vulnIdFromTool: string | null;
  status: string;
}

export interface FindingNote {
  id: number;
  findingId: number;
  author: string;
  noteType: string;
  content: string;
  createdAt: string;
}

export interface FindingCounts {
  Critical: number;
  High: number;
  Medium: number;
  Low: number;
  Info: number;
  total: number;
  riskAccepted: number;
}

export type ScanStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed';

export interface ScanStep {
  id: number;
  scanId: string;
  stepName: string;
  stepOrder: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  artifactsPath: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ScanModuleProgress {
  total: number;
  completed: number;
}

/** One surviving (post-retry) failure inside a scan that completed with errors. */
export interface ScanStepError {
  /** What failed: a security tool run or an AI Sniper module. */
  kind: 'tool' | 'module';
  /** Tool key (e.g. 'semgrep') or module name (e.g. 'src/api'). */
  name: string;
  /** Detailed error text (includes per-attempt info for retried modules). */
  error: string;
  /** True when the failure survived the end-of-step retry pass. */
  failedAfterRetry: boolean;
}

export interface ScanDetail {
  id: string;
  status: ScanStatus;
  repoUrl: string | null;
  repoName: string;
  branch: string | null;
  commitHash: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  resumesAt: string | null;
  createdAt: string;
  repositoryId: number | null;
  workspaceId: number | null;
  scanType: string;
  /** status='completed' but some tools/modules failed even after retry. */
  completedWithErrors?: boolean;
  /** The surviving failures when completedWithErrors is true. */
  stepErrors?: ScanStepError[];
  steps: ScanStep[];
  moduleProgress: ScanModuleProgress;
}

export interface ScanEvent {
  id: number;
  scanId: string | null;
  stepName: string | null;
  createdAt: string;
  level: 'info' | 'warning' | 'error';
  source: string;
  message: string;
  details: Record<string, unknown>;
  repoName: string | null;
  /** Resolved via the event's scan (LEFT JOIN scans) — null for events without a scan. */
  repositoryId?: number | null;
  workspaceId: number | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface ScanEventStats {
  unresolved: number;
  unresolvedErrors: number;
  unresolvedWarnings: number;
  total: number;
}

/** Severity levels in priority order */
export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Finding status options */
export const STATUSES = ['Open', 'Risk Accepted', 'False Positive', 'Fixed', 'Duplicate'] as const;
export type Status = (typeof STATUSES)[number];

export interface Source {
  id: number;
  workspaceId: number;
  provider: 'github' | 'gitlab' | 'bitbucket' | 'local';
  baseUrl: string;
  orgName: string | null;
  orgType: string | null;
  detectedScopes: string[];
  lastSyncedAt: string | null;
  syncIntervalMinutes: number;
  createdAt: string;
}

export interface DiscoveredRepo {
  slug: string;
  fullName: string;
  cloneUrl: string;
  description: string | null;
  imported: boolean;
  sizeBytes?: number | null;
  primaryLanguage?: string | null;
  lastActivityAt?: string | null;
}

export interface WorkspaceEvent {
  id: number;
  workspaceId: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Repository status values */
export const REPO_STATUSES = ['pending', 'queued', 'analyzing', 'completed', 'ignored'] as const;
export type RepoStatus = (typeof REPO_STATUSES)[number];

export interface WorkspaceMember {
  id: number;
  userId: number;
  workspaceId: number;
  role: 'workspace_admin' | 'member';
  createdAt: string;
  username: string;
  displayName: string | null;
}

export interface AddMemberResponse {
  member: WorkspaceMember;
  generatedPassword?: string;
}

/** A login account suggested by the add-member picker (not yet in the workspace). */
export interface WorkspaceUserOption {
  id: number;
  username: string;
  displayName: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  workspaces: Array<{
    workspaceId: number;
    name: string;
    role: string;
  }>;
}

export interface AdminWorkspace {
  id: number;
  name: string;
  description: string | null;
  defaultLanguage: string | null;
  createdAt: string;
  memberCount: number;
  scanCount: number;
}

// ── Tool Configuration ─────────────────────────────────────────

export type ToolCategory = 'secrets' | 'sast' | 'sca' | 'iac' | 'pii';
export type ToolPricing = 'free' | 'free_tier' | 'paid';

export interface CredentialField {
  envVar: string;
  label: string;
  placeholder: string;
  helpUrl: string;
  required: boolean;
  vaultLabel: string;
}

export interface ToolDefinition {
  key: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  website: string;
  credentials: CredentialField[];
  recommended: boolean;
  pricing: ToolPricing;
  runnerKey: string;
  runnerArgs?: Record<string, string>;
}

export interface WorkspaceToolSelection {
  tool_key: string;
  enabled: boolean;
  has_credentials: boolean;
}
