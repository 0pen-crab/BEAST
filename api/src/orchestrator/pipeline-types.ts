import type { Scan } from '../db/schema.ts';

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
  repoUrl: string;
  repoName: string;
  branch: string;
  commitHash: string;
  localPath: string;
  teamName: string;
  workspaceName: string;
  workspaceId: number;
  workDir: string;
  repoPath: string;
  toolsDir: string;
  agentDir: string;
  /** @deprecated alias for toolsDir — used by steps that haven't been migrated yet */
  resultsDir: string;
  /** @deprecated alias for agentDir/repo-profile.md */
  profilePath: string;
  cloneUrl: string;
  /** Language code for reports (e.g. 'en', 'uk'). Read from workspace.default_language */
  reportLanguage: string;
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
  required: boolean;
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
}

export interface AiResearchOutput {
  scanCompleted: boolean;
  skipped: boolean;
  durationMs: number;
  cost?: number;
}

export interface ImportOutput {
  repositoryId: number;
  workspaceId: number;
  findingsImported: number;
  testsCreated: number;
  resultFiles: ResultFile[];
  findingsPerContributor: Record<string, Record<string, number>>;
  emailAliases: Record<string, string[]>;
}

export interface TriageReportOutput {
  triaged: number;
  dismissed: number;
  kept: number;
  reportsGenerated: boolean;
  assessmentsEnhanced: number;
  durationMs: number;
}

// ── Result file interface (previously duplicated in 3 files) ──
export interface ResultFile {
  key: string;
  filename: string;
  scanType: string;
  testTitle: string;
  content_b64: string;
}
