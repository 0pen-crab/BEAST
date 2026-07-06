import type { Scan, ScanStepError } from '../db/schema.ts';

// Structured surviving-failure entry (tool or module that stayed failed after
// its retry pass). Defined next to the scans table (persisted in
// scans.step_errors) and re-exported here for step/pipeline consumers.
export type { ScanStepError } from '../db/schema.ts';

// ── AI timeout constants (previously duplicated in 3 files) ──
export const AI_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000; // 20 min
export const AI_MAX_TIMEOUT_MS        = 60 * 60 * 1000; // 60 min

// ── Scanner UID for shared volume permissions ──
export const SCANNER_UID = 1001;
export const SCANNER_GID = 1001;

// ── Scan scope constants (previously duplicated in 3 prompts) ──
export const SOURCE_EXTENSIONS = [
  '.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.rs', '.rb',
  '.php', '.cs', '.c', '.cpp', '.h', '.hpp',
  '.swift', '.kt', '.scala', '.vue', '.svelte',
  '.lua', '.r', '.R', '.ex', '.exs',
  '.erl', '.hrl', '.clj', '.cljs',
];

export const EXCLUDED_DIRS = [
  '.git', '.svn', '.hg',
  'node_modules', 'vendor', 'bower_components', '.npm', '.yarn', '.pnpm',
  'venv', '.venv', '.tox', '.eggs', '__pycache__',
  'dist', 'build', 'out', 'target', '_build', '_cargo',
  '.next', '.nuxt', '.output',
  'coverage', '.nyc_output', 'htmlcov',
  'third_party', 'third-party', 'deps', 'external',
  'generated', 'migrations',
  '.idea', '.vscode',
  'wp-includes', 'wp-admin',
  '.terraform',
];

export const EXCLUDED_FILE_PATTERNS = [
  '*.min.js', '*.min.css', '*.min.mjs',
  '*.bundle.js', '*.chunk.js', '*.vendor.js',
  '*.generated.*', '*.auto.*',
  '*.pb.go', '*_pb2.py', '*.pb.cc', '*.pb.h',
  '*.designer.cs', '*.Designer.cs', '*.g.cs',
  '*.d.ts', '*.d.mts', '*.d.cts', '*.map',
  '*.spec.js', '*.spec.ts', '*.spec.tsx', '*.spec.jsx',
  '*.test.js', '*.test.ts', '*.test.tsx', '*.test.jsx',
  '*_test.go', '*_test.py', '*_spec.rb',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'composer.lock', 'Gemfile.lock', 'Pipfile.lock',
  'poetry.lock', 'Cargo.lock', 'go.sum',
];

// ── Pipeline context ──
export interface PipelineContext {
  scanId: string;
  /** Unique repository id from the scan — the source of truth. Steps must resolve the
   *  repo by this id, never by name (two repos can share a name across sources). */
  repositoryId: number;
  repoUrl: string;
  repoName: string;
  branch: string;
  commitHash: string;
  localPath: string;
  teamName: string;
  workspaceName: string;
  workspaceId: number;
  /** Per-repo base dir on the shared volume (`/workspace/src-<sourceId>/<repoName>`,
   *  or `/workspace/repo-<repositoryId>/<repoName>` when the repo has no source).
   *  Keyed by source id so same-named repos from different sources never share
   *  a clone dir / profile / scan-context. */
  repoBaseDir: string;
  workDir: string;
  repoPath: string;
  toolsDir: string;
  agentDir: string;
  /** @deprecated alias for toolsDir — used by steps that haven't been migrated yet */
  resultsDir: string;
  /** Human-facing Repository Profile markdown (shown in UI). Written by analyzer. */
  profilePath: string;
  /** Agent-only scan context markdown (Summary, Module Map, Security Context,
   *  Trust Boundaries, Complexity Hotspots). Consumed by the scanner & triage
   *  agents — NOT shown in the UI. Written by analyzer alongside the profile. */
  scanContextPath: string;
  cloneUrl: string;
  /** Language code for reports (e.g. 'en', 'uk'). Read from workspace.default_language */
  reportLanguage: string;
  /** Workspace AI feature toggles — read from workspaces table */
  aiAnalysisEnabled: boolean;
  aiScanningEnabled: boolean;
  aiTriageEnabled: boolean;
  /** AI model keys per step — read from workspaces table */
  aiModelAnalyzer: string;
  aiModelScanner: string;
  aiModelTriage: string;
  /** Target files-per-Sniper-module from workspace settings (1500/500/100). */
  scanDepth?: number;
  /** Cancellation signal — fired when user cancels the scan via API. Propagated
   *  to every SSH/HTTP call so long-running operations abort within seconds
   *  instead of waiting for natural completion. */
  cancelSignal?: AbortSignal;
}

// ── Step interface ──
export interface StepInput {
  ctx: PipelineContext;
  prev: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StepFn = (input: StepInput) => Promise<Record<string, any>>;

export interface StepDef {
  name: string;
  run: StepFn;
  /** A required step's failure fails the whole scan. Can depend on the scan
   *  context so a step is required exactly when its workspace toggle says it
   *  must run — if a feature was supposed to run and didn't, the scan fails
   *  instead of silently degrading. */
  required: boolean | ((ctx: PipelineContext) => boolean);
}

// ── AI usage tracking (extracted from Claude Code stream-json result) ──
export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

// ── Typed step outputs ──
export interface CloneOutput {
  repoPath: string;
  cloneUrl: string;
  branch: string;
  commitHash: string;
}

export interface AnalysisOutput {
  aiAvailable: boolean;
  profileGenerated: boolean;
  contributorsAssessed: number;
  metadataPath: string;
  aiUsage?: AiUsage;
}

export interface ToolResult {
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  findingsCount: number;
  error?: string;
}

export interface SecurityToolsOutput {
  toolResults: Record<string, ToolResult>;
  totalDurationMs: number;
  /** Enabled tools that stayed failed after the retry pass. The step does NOT
   *  throw for these — the pipeline finishes as "completed with errors" and
   *  the worker persists them on the scan (scans.step_errors). */
  toolErrors?: ScanStepError[];
}

export interface AiResearchOutput {
  scanCompleted: boolean;
  skipped: boolean;
  durationMs: number;
  /** Why the step skipped, when skipped=true — surfaced to the Events page. */
  skipReason?: 'ai-scanning-disabled' | 'analysis-failed';
  cost?: number;
  aiUsage?: AiUsage;
  /** Sniper modules that stayed failed after the end-of-step retry pass. The
   *  step does NOT throw for these (unless EVERY module failed) — the pipeline
   *  finishes as "completed with errors" and the worker persists them. */
  moduleErrors?: ScanStepError[];
}

// ── Prepared plan (staged repo data — committed by the 'commit' step) ──
// Maintainer policy: scan-produced repo data (findings, tests, contributor
// stats/assessments) is written to the DB only AFTER every pipeline step has
// succeeded. The import step PREPARES this plan; it travels through
// scan_steps.output (same resume mechanism as resultFiles) and the final
// 'commit' step writes it.

/** A tests-table row to create at commit time — one per tool result file. */
export interface PreparedTest {
  /** Result-file key (e.g. 'gitleaks', 'code-analysis') — links prepared findings to their test. */
  key: string;
  tool: string;
  scanType: string;
  testTitle?: string;
  fileName: string;
  /** Deduplicated findings count (distinct fingerprints) — shown per tool on the repo page. */
  findingsCount: number;
}

/** A findings-table row to insert/update at commit time. */
export interface PreparedFinding {
  /** Stable temp id within this scan's plan (index order). Triage decisions
   *  reference findings by this id — DB ids don't exist until commit. */
  tempId: number;
  /** Key of the PreparedTest this finding belongs to. */
  testKey: string;
  title: string;
  severity: string;
  description?: string;
  filePath?: string;
  line?: number;
  vulnIdFromTool?: string;
  cwe?: number;
  cvssScore?: number;
  tool: string;
  category?: string;
  codeSnippet?: string;
  secretValue?: string;
  fingerprint: string;
  /** Existing DB finding (from a previous successful scan) matched read-only
   *  by fingerprint during prepare. Commit UPDATES + re-parents that row
   *  instead of inserting a new one. */
  matchedFindingId?: number;
}

export interface ImportOutput {
  repositoryId: number;
  workspaceId: number;
  /** Count of prepared (deduplicated) findings — nothing is in the DB yet. */
  findingsPrepared: number;
  /** Count of prepared tests — created in the DB by the commit step. */
  testsPrepared: number;
  resultFiles: ResultFile[];
  preparedTests: PreparedTest[];
  preparedFindings: PreparedFinding[];
  /** Analyzer contributor assessments (deduplicated) — ingested at commit. */
  analyzerAssessments: unknown[];
  emailAliases: Record<string, string[]>;
}

export interface TriageReportOutput {
  /** True when the step did not run — mirrors AiResearchOutput.skipped. */
  skipped?: boolean;
  /** Why the step skipped, when skipped=true — mirrors AiResearchOutput.skipReason
   *  naming ('ai-scanning-disabled' / 'analysis-failed'). Surfaced in the step
   *  output on the Scans page so zeroes are distinguishable from "found nothing". */
  skipReason?: 'ai-triage-disabled' | 'analysis-failed';
  triaged: number;
  /** Decisions that WILL dismiss findings at commit (risk_accept/false_positive/duplicate). */
  dismissed: number;
  kept: number;
  reportsGenerated: boolean;
  assessmentsEnhanced: number;
  durationMs: number;
  aiUsage?: AiUsage;
  /** Triage decisions keyed by prepared-finding temp ids. Applied to the DB
   *  by the commit step — findings enter the DB already triaged. */
  decisions: TriageDecisionPlan[];
  /** Triage-produced contributor assessment enhancements — applied at commit. */
  devAssessments: unknown[];
}

/** Serializable triage decision — finding_id refers to PreparedFinding.tempId. */
export interface TriageDecisionPlan {
  finding_id: number;
  action: 'risk_accept' | 'false_positive' | 'duplicate' | 'keep';
  reason: string;
  /** Temp id of the finding this one duplicates (resolved to a DB id at commit). */
  duplicate_of?: number;
  /** SEMANTIC cross-scan match: DB id of an EXISTING AI ('beast') finding from
   *  a previous scan that this prepared finding is the same real issue as.
   *  AI findings can never fingerprint-match (titles are rephrased every run),
   *  so the triage agent matches them by meaning. Commit UPDATES that row
   *  instead of inserting a duplicate. Validated against the candidate set in
   *  the triage step; re-validated (tool='beast', first-wins) at commit. */
  same_as?: number;
  contributor_email?: string;
  contributor_name?: string;
}

export interface CommitOutput {
  testsCreated: number;
  findingsNew: number;
  findingsUpdated: number;
  /** Findings committed with a dismissed status (triage dispositions applied). */
  dismissed: number;
  /** AI ('beast') findings that semantically matched an existing AI finding
   *  from a previous scan (triage `same_as`) and UPDATED that row instead of
   *  inserting a duplicate. Subset of findingsUpdated. */
  semanticMatches: number;
  /** Contributors who received new assessments in this scan. Feedback
   *  compilation for them is queued by the pipeline ONLY after the whole
   *  scan succeeds — a failed scan must not update developer profiles. */
  assessedContributorIds: number[];
}

// ── Result file interface (previously duplicated in 3 files) ──
export interface ResultFile {
  key: string;
  filename: string;
  scanType: string;
  testTitle: string;
  content_b64: string;
}
