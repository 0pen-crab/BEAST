import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { addScanFile, createWorkspaceEvent, computeFingerprint, normalizeSeverity } from '../entities.ts';
import { ensureWorkspace, ensureTeam, ensureRepository } from '../entities.ts';
import { parseSarif, parseGitleaks, parseTrufflehog, parseTrivy, type ParsedFinding } from './parsers.ts';
import { db } from '../../db/index.ts';
import { scans, scanEvents, repositories, findings } from '../../db/schema.ts';
import { ingestContributors, findOrCreateContributor, type IngestContributor, type IngestAssessment } from '../../routes/contributors.ts';
import type {
  PipelineContext, StepInput, ImportOutput, ResultFile,
  PreparedTest, PreparedFinding,
} from '../pipeline-types.ts';
import { sanitizeForDb } from '../../lib/sanitize.ts';

// ── BeastIds (absorbed from db-setup.ts) ─────────────────────────

export interface BeastIds {
  workspaceId: number;
  teamId: number;
  repositoryId: number;
}

// ── PrepareSummary ───────────────────────────────────────────────
// Maintainer policy: the import step no longer WRITES repo data — it parses
// tool outputs into a serializable plan (prepared tests + findings) that the
// final 'commit' step writes only after every pipeline step has succeeded.

export interface PrepareSummary {
  resultFiles: ResultFile[];
  preparedTests: PreparedTest[];
  preparedFindings: PreparedFinding[];
  imports: Array<{ key: string; findingsCount?: number; error?: string }>;
}

// ── Tool → category mapping ─────────────────────────────────────

export const TOOL_CATEGORY_MAP: Record<string, string> = {
  'beast': 'sast',
  'gitleaks': 'secrets',
  'trufflehog': 'secrets',
  'trivy-secrets': 'secrets',
  'trivy-sca': 'sca',
  'trivy-iac': 'iac',
  'jfrog': 'sca',
  'semgrep': 'sast',
  'osv-scanner': 'sca',
  'checkov': 'iac',
  'gitguardian': 'secrets',
  'snyk-sca': 'sca',
  'snyk-code': 'sast',
  'snyk-iac': 'iac',
  'presidio': 'pii',
  'semgrep-pii': 'pii',
};

// ── Tool key mapping: result file key -> tool name for DB ────────

export const TOOL_MAP: Record<string, string> = {
  'code-analysis': 'beast',
  'gitleaks': 'gitleaks',
  'trufflehog': 'trufflehog',
  'trivy-secrets': 'trivy-secrets',
  'trivy-sca': 'trivy-sca',
  'trivy-iac': 'trivy-iac',
  'jf-audit': 'jfrog',
  'semgrep': 'semgrep',
  'osv-scanner': 'osv-scanner',
  'checkov': 'checkov',
  'gitguardian': 'gitguardian',
  'snyk-sca': 'snyk-sca',
  'snyk-code': 'snyk-code',
  'snyk-iac': 'snyk-iac',
  'presidio': 'presidio',
  'semgrep-pii': 'semgrep-pii',
};

const RESULT_SPECS: [string, string, string, string][] = [
  ['code-analysis', 'code-analysis.sarif', 'SARIF', 'BEAST Code Analysis'],
  ['gitleaks', 'gitleaks-results.json', 'Gitleaks Scan', ''],
  ['trufflehog', 'trufflehog-results.json', 'Trufflehog Scan', ''],
  ['trivy-secrets', 'trivy-secrets-results.json', 'Trivy Secrets', ''],
  ['trivy-sca', 'trivy-sca-results.json', 'Trivy SCA', ''],
  ['trivy-iac', 'trivy-iac-results.json', 'Trivy IaC', ''],
  ['jf-audit', 'jf-audit-results.sarif', 'SARIF', 'JFrog Xray'],
  ['semgrep', 'semgrep-results.sarif', 'SARIF', 'Semgrep SAST'],
  ['osv-scanner', 'osv-scanner-results.sarif', 'SARIF', 'OSV-Scanner'],
  ['checkov', 'checkov-results.sarif', 'SARIF', 'Checkov IaC'],
  ['gitguardian', 'gitguardian-results.sarif', 'SARIF', 'GitGuardian'],
  ['snyk-sca', 'snyk-sca-results.sarif', 'SARIF', 'Snyk SCA'],
  ['snyk-code', 'snyk-code-results.sarif', 'SARIF', 'Snyk Code'],
  ['snyk-iac', 'snyk-iac-results.sarif', 'SARIF', 'Snyk IaC'],
  ['presidio', 'presidio-results.sarif', 'SARIF', 'Presidio PII'],
  ['semgrep-pii', 'semgrep-pii-results.sarif', 'SARIF', 'Semgrep PII'],
  ['git-stats', 'git-contributor-stats.json', '_stats', ''],
];

// ── setupDatabase (absorbed from db-setup.ts) ────────────────────

export async function setupDatabase(ctx: PipelineContext): Promise<BeastIds> {
  // New flow: the scan already knows its repository (the worker linked it on claim).
  // Resolve the repo from the scan's OWN repository_id — never by name. Two repos can
  // share a name across sources (e.g. a Bitbucket "trinity" and a local-upload
  // "trinity"); a name lookup grabbed the wrong one and wrote findings under it.
  if (ctx.workspaceId && ctx.workspaceId > 0) {
    const [scan] = await db.select({ repositoryId: scans.repositoryId })
      .from(scans)
      .where(eq(scans.id, ctx.scanId));

    if (scan?.repositoryId) {
      const [repo] = await db.select({ id: repositories.id, teamId: repositories.teamId })
        .from(repositories)
        .where(eq(repositories.id, scan.repositoryId));

      if (repo) {
        return {
          workspaceId: ctx.workspaceId,
          teamId: repo.teamId,
          repositoryId: repo.id,
        };
      }
    }
  }

  // Fallback: legacy flow — derive workspace from context
  const workspace = await ensureWorkspace(ctx.workspaceName);
  const team = await ensureTeam(workspace.id, 'default');
  const repo = await ensureRepository(team.id, ctx.repoName, ctx.repoUrl || undefined);

  await db.update(scans)
    .set({ repositoryId: repo.id, workspaceId: workspace.id })
    .where(eq(scans.id, ctx.scanId));

  return {
    workspaceId: workspace.id,
    teamId: team.id,
    repositoryId: repo.id,
  };
}

// ── storeReports (absorbed from finalize.ts) ─────────────────────

// Stores the Security Audit report. The human Repository Profile is persisted
// by the analyzer step (fileType 'profile') — do NOT store it again here or the
// UI ends up with two duplicate 'profile' scan_files.
export async function storeReports(
  scanId: string,
  reportContent: string,
): Promise<void> {
  if (reportContent) {
    await addScanFile({
      scanId,
      fileName: 'final-report.md',
      fileType: 'audit',
      content: reportContent,
    });
  }
}

// ── ingestContributorStats (absorbed from finalize.ts) ───────────
// Called from the COMMIT step only — contributor stats/assessments are repo
// data and must not be written mid-scan. Kept here next to the git-stats
// extraction it consumes.

export async function ingestContributorStats(
  ctx: PipelineContext,
  scanId: string,
  repositoryId: number,
  resultFiles: Array<{ key: string; content_b64: string }>,
  devAssessments: unknown[],
  workspaceId: number,
): Promise<number[]> {
  const statsFile = resultFiles.find(f => f.key === 'git-stats');
  if (!statsFile) return [];

  let gitStats: IngestContributor[];
  try {
    gitStats = JSON.parse(Buffer.from(statsFile.content_b64, 'base64').toString('utf8'));
  } catch (err) {
    // Corrupt git-stats must scream like the ingest-failure path below —
    // otherwise contributor ingest is silently skipped for the whole scan.
    const message = `Corrupt git-stats JSON — contributor ingest skipped: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[import] ${message} (scan ${scanId})`);
    await db.insert(scanEvents).values({
      scanId,
      stepName: 'commit',
      level: 'error',
      source: 'contributor-ingest',
      message,
      details: { file: 'git-contributor-stats.json' },
      repoName: ctx.repoName,
      workspaceId: workspaceId ?? null,
    });
    if (workspaceId) {
      try {
        await createWorkspaceEvent(workspaceId, 'contributor_ingest_failed', {
          scan_id: scanId,
          repo_name: ctx.repoName,
          error: message,
        });
      } catch (eventErr) {
        console.error(`[import] Failed to create workspace event for corrupt git-stats:`, eventErr instanceof Error ? eventErr.message : eventErr);
      }
    }
    return [];
  }
  if (!Array.isArray(gitStats) || gitStats.length === 0) return [];

  try {
    const result = await ingestContributors({
      repoName: ctx.repoName,
      repoUrl: ctx.repoUrl,
      workspaceId,
      executionId: scanId,
      contributors: gitStats,
      assessments: devAssessments as IngestAssessment[],
    });

    // Contributors who got new assessments. Feedback compilation is queued by
    // the PIPELINE only after the whole scan succeeds — a failed scan must not
    // leave partial side effects like half-updated developer profiles.
    if (result.newAssessments > 0) {
      return [...new Set(Object.values(result.contributorIds))];
    }
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(scanEvents).values({
      scanId,
      stepName: 'commit',
      level: 'warning',
      source: 'contributor-ingest',
      message: 'Contributor stats ingest failed',
      details: { error: message },
      repoName: ctx.repoName,
      workspaceId: workspaceId ?? null,
    });
    if (workspaceId) {
      try {
        await createWorkspaceEvent(workspaceId, 'contributor_ingest_failed', {
          scan_id: scanId,
          repo_name: ctx.repoName,
          error: message,
        });
      } catch (eventErr) {
        console.error(`[import] Failed to create workspace event for ingest failure:`, eventErr instanceof Error ? eventErr.message : eventErr);
      }
    }
  }
  return [];
}

// ── extractGitStats ──────────────────────────────────────────────

export interface GitContributorStats {
  email: string;
  name: string;
  commits: number;
  loc_added: number;
  loc_removed: number;
  first_commit: string;
  last_commit: string;
  file_types: Record<string, number>;
  daily_activity: Record<string, number>;
}

export function extractGitStats(repoPath: string): GitContributorStats[] {
  let logOutput: string;
  try {
    logOutput = execSync(
      `git -C "${repoPath}" log --all --format="%aE|%aN|%aI" --numstat`,
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 50 * 1024 * 1024 },
    );
  } catch (err) {
    console.error(`[import] Failed to extract git stats from ${repoPath}:`, err instanceof Error ? err.message : err);
    return [];
  }

  if (!logOutput || !logOutput.trim()) return [];

  // Parse git log output line by line
  const contributors = new Map<string, {
    name: string;
    commits: number;
    loc_added: number;
    loc_removed: number;
    first_commit: string;
    last_commit: string;
    file_types: Record<string, number>;
    daily_activity: Record<string, number>;
  }>();

  let currentEmail = '';

  for (const line of logOutput.split('\n')) {
    // Header line: email|name|date
    const headerMatch = line.match(/^([^|]+@[^|]+)\|([^|]+)\|(.+)$/);
    if (headerMatch) {
      currentEmail = headerMatch[1].toLowerCase();
      const name = headerMatch[2];
      const dateStr = headerMatch[3];
      const day = dateStr.split('T')[0];

      let entry = contributors.get(currentEmail);
      if (!entry) {
        entry = {
          name,
          commits: 0,
          loc_added: 0,
          loc_removed: 0,
          first_commit: day,
          last_commit: day,
          file_types: {},
          daily_activity: {},
        };
        contributors.set(currentEmail, entry);
      }

      entry.name = name; // keep latest name
      entry.commits++;

      // Track first/last commit dates
      if (day < entry.first_commit) entry.first_commit = day;
      if (day > entry.last_commit) entry.last_commit = day;

      // Daily activity
      entry.daily_activity[day] = (entry.daily_activity[day] || 0) + 1;
      continue;
    }

    // Numstat line: added\tremoved\tfile
    const numstatMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (numstatMatch && currentEmail) {
      const entry = contributors.get(currentEmail);
      if (!entry) continue;

      const added = numstatMatch[1];
      const removed = numstatMatch[2];
      const file = numstatMatch[3];

      if (added !== '-') entry.loc_added += parseInt(added, 10);
      if (removed !== '-') entry.loc_removed += parseInt(removed, 10);

      // Extract file extension
      const dotIdx = file.lastIndexOf('.');
      if (dotIdx > 0) {
        const ext = file.slice(dotIdx);
        entry.file_types[ext] = (entry.file_types[ext] || 0) + 1;
      }
    }
  }

  // Convert map to array
  const result: GitContributorStats[] = [];
  for (const [email, data] of contributors) {
    result.push({
      email,
      name: data.name,
      commits: data.commits,
      loc_added: data.loc_added,
      loc_removed: data.loc_removed,
      first_commit: data.first_commit,
      last_commit: data.last_commit,
      file_types: data.file_types,
      daily_activity: data.daily_activity,
    });
  }

  return result;
}

// ── mergeStatsByContributor ──────────────────────────────────────
// Groups git stats by resolved contributor ID so merged contributors
// appear as a single entry with combined stats.
// Returns merged stats + email alias map for the AI agent.
// NOTE: findOrCreateContributor may create bare contributor IDENTITY rows
// mid-scan. That is deliberate: identity rows carry no scan data (stats /
// assessments land only at commit) and the analyzer step already creates
// them the same way; cleanup documents contributors as cross-scan entities.

export async function mergeStatsByContributor(
  gitStats: GitContributorStats[],
  workspaceId: number,
): Promise<{ merged: GitContributorStats[]; emailAliases: Record<string, string[]> }> {
  // Resolve each email to a contributor ID
  const emailToContribId = new Map<string, number>();
  const contribIdToEmails = new Map<number, string[]>();

  for (const s of gitStats) {
    const { findOrCreateContributor } = await import('../../routes/contributors.ts');
    const contribId = await findOrCreateContributor(s.email, s.name, workspaceId);
    emailToContribId.set(s.email, contribId);
    const existing = contribIdToEmails.get(contribId) ?? [];
    existing.push(s.email);
    contribIdToEmails.set(contribId, existing);
  }

  // Group stats by contributor ID
  const grouped = new Map<number, GitContributorStats>();
  for (const s of gitStats) {
    const contribId = emailToContribId.get(s.email)!;
    const existing = grouped.get(contribId);
    if (!existing) {
      grouped.set(contribId, { ...s });
      continue;
    }
    // Merge stats.
    // Name first: "keep the most recent name" must compare against the
    // PRE-merge last_commit — after `existing.last_commit` is raised to the
    // max the comparison can never fire (dead branch: the alias with the
    // newer commit never won the display name).
    if (s.last_commit > existing.last_commit) existing.name = s.name;
    existing.commits += s.commits;
    existing.loc_added += s.loc_added;
    existing.loc_removed += s.loc_removed;
    if (s.first_commit < existing.first_commit) existing.first_commit = s.first_commit;
    if (s.last_commit > existing.last_commit) existing.last_commit = s.last_commit;
    for (const [ext, count] of Object.entries(s.file_types)) {
      existing.file_types[ext] = (existing.file_types[ext] || 0) + count;
    }
    for (const [date, count] of Object.entries(s.daily_activity)) {
      existing.daily_activity[date] = (existing.daily_activity[date] || 0) + count;
    }
  }

  // Build email aliases map (only for contributors with multiple emails)
  const emailAliases: Record<string, string[]> = {};
  for (const [, emails] of contribIdToEmails) {
    if (emails.length > 1) {
      // Primary = the one used in the merged stats entry
      const contribId = emailToContribId.get(emails[0])!;
      const primary = grouped.get(contribId)!.email;
      emailAliases[primary] = emails.filter((e) => e !== primary);
    }
  }

  return { merged: Array.from(grouped.values()), emailAliases };
}

// ── deduplicateFeedbackText ───────────────────────────────────────
// Claude sometimes duplicates the assessment text inside the feedback field.
// Detect and remove the duplicate by checking if the second half repeats the first.

export function deduplicateFeedbackText(feedback: string): string {
  if (!feedback || feedback.length < 200) return feedback;

  // Try splitting at common section headers that indicate a repeat
  const markers = ['**Strengths:**', '**Сильні сторони:**', '### Security Findings', '### Знахідки безпеки'];
  for (const marker of markers) {
    const first = feedback.indexOf(marker);
    if (first === -1) continue;
    const second = feedback.indexOf(marker, first + marker.length);
    if (second === -1) continue;
    // Found the same marker twice — keep only up to the second occurrence
    return feedback.slice(0, second).trimEnd();
  }

  return feedback;
}

// ── deduplicateAssessments ────────────────────────────────────────
// Multiple email aliases can produce duplicate assessments for the same
// contributor. Resolve each email → contributor ID and keep only the
// assessment with the longest feedback per contributor.

export async function deduplicateAssessments(
  assessments: unknown[],
  workspaceId: number,
): Promise<unknown[]> {
  const typed = assessments as Array<{ email?: string; feedback?: string; [k: string]: unknown }>;
  const byContribId = new Map<number, typeof typed[number]>();

  for (const a of typed) {
    if (!a.email) continue;
    const contribId = await findOrCreateContributor(a.email, '', workspaceId);
    const existing = byContribId.get(contribId);
    if (!existing || (a.feedback?.length ?? 0) > (existing.feedback?.length ?? 0)) {
      byContribId.set(contribId, a);
    }
  }

  return Array.from(byContribId.values());
}

// ── readResults ──────────────────────────────────────────────────

export async function readResults(ctx: { resultsDir: string }): Promise<ResultFile[]> {
  const results: ResultFile[] = [];
  console.log(`[import] readResults: scanning ${ctx.resultsDir} for ${RESULT_SPECS.length} result specs`);

  for (const [key, filename, scanType, testTitle] of RESULT_SPECS) {
    const filePath = path.join(ctx.resultsDir, filename);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) {
        const content = fs.readFileSync(filePath);
        results.push({
          key,
          filename,
          scanType,
          testTitle,
          content_b64: content.toString('base64'),
        });
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        // File not found — normal for tools that didn't run
      } else {
        console.error(`[import] Failed to read result file ${filePath}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`[import] readResults: found ${results.length} files: [${results.map(r => r.key).join(', ')}]`);
  return results;
}

// ── importToDatabase ─────────────────────────────────────────────

/** Normalize file path from different tool formats to relative path from repo root */
export function normalizeFilePath(filePath: string): string {
  let p = filePath;
  // gitguardian: file:///workspace/{repo}/repo/path → path
  p = p.replace(/^file:\/\/\/workspace\/[^/]+\/repo\//, '');
  // checkov: workspace/{repo}/repo/path → path
  p = p.replace(/^workspace\/[^/]+\/repo\//, '');
  return p;
}

/** Extract 15 lines of code context (7 above + target + 7 below) */
export function extractCodeSnippet(repoPath: string, filePath: string, line: number | null | undefined): string | undefined {
  if (!filePath || !line || line < 1) return undefined;
  const clean = normalizeFilePath(filePath);
  const fullPath = path.resolve(repoPath, clean);
  try {
    if (!fs.existsSync(fullPath)) return undefined;
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    const start = Math.max(0, line - 8);   // 7 lines above (0-indexed: line-1 is target, line-8 is 7 above)
    const end = Math.min(lines.length, line + 7); // 7 lines below
    return lines.slice(start, end).map((l, i) => {
      const num = start + i + 1;
      const marker = num === line ? '>' : ' ';
      return `${marker} ${String(num).padStart(4)} | ${l}`;
    }).join('\n');
  } catch {
    return undefined;
  }
}

/**
 * READ-ONLY dedup matching: find existing findings of this repository whose
 * fingerprints match the prepared ones. The WRITE side of the old upsert
 * (update + re-parent + status reset) moved to the commit step — here we only
 * record WHICH existing row each prepared finding matched.
 */
export async function matchExistingFindings(
  repositoryId: number,
  fingerprints: string[],
): Promise<Map<string, number>> {
  const matched = new Map<string, number>();
  if (!repositoryId || fingerprints.length === 0) return matched;

  const rows = await db.select({ id: findings.id, fingerprint: findings.fingerprint })
    .from(findings)
    .where(and(
      inArray(findings.fingerprint, fingerprints),
      eq(findings.repositoryId, repositoryId),
      ne(findings.status, 'duplicate'),
    ));

  // Mirror upsertFinding: first matching row wins (rows come back in id order
  // only incidentally, but duplicates-by-fingerprint are already exceptional).
  for (const row of rows) {
    if (row.fingerprint && !matched.has(row.fingerprint)) {
      matched.set(row.fingerprint, row.id);
    }
  }
  return matched;
}

/**
 * Parse tool result files into a serializable import PLAN. No repo-data
 * writes — the only DB writes here are scan_files raw artifacts (diagnostic
 * data, allowed mid-scan so failed scans keep their tool outputs on record).
 */
export async function prepareImportPlan(
  scanId: string,
  repositoryId: number,
  resultFiles: ResultFile[],
  repoPath?: string,
): Promise<PrepareSummary> {
  const imports: PrepareSummary['imports'] = [];
  const preparedTests: PreparedTest[] = [];
  const preparedFindings: PreparedFinding[] = [];
  // Scan-wide dedup by fingerprint (a tool can report the same CVE/secret on
  // the same location many times) — mirrors the old upsertFinding collapse.
  const seenFingerprints = new Set<string>();

  // Filter out stats file (not findings)
  const importable = resultFiles.filter(rf => rf.scanType !== '_stats');

  for (const rf of importable) {
    try {
      const content = Buffer.from(rf.content_b64, 'base64').toString('utf8');
      const tool = TOOL_MAP[rf.key] || rf.key;

      // Save raw scan artifact for download (diagnostics — kept mid-scan)
      await addScanFile({
        scanId,
        fileName: rf.filename,
        fileType: `raw-${tool}`,
        content,
      });

      // Parse results based on tool type
      let parsed: ParsedFinding[];
      switch (rf.key) {
        case 'code-analysis':
        case 'jf-audit':
        case 'semgrep':
        case 'osv-scanner':
        case 'checkov':
        case 'gitguardian':
        case 'snyk-sca':
        case 'snyk-code':
        case 'snyk-iac':
        case 'presidio':
        case 'semgrep-pii':
          parsed = parseSarif(content, rf.filename);
          break;
        case 'gitleaks':
          parsed = parseGitleaks(content, rf.filename);
          break;
        case 'trufflehog':
          parsed = parseTrufflehog(content, rf.filename);
          break;
        case 'trivy-secrets':
        case 'trivy-sca':
        case 'trivy-iac':
          parsed = parseTrivy(content, rf.filename);
          break;
        default:
          parsed = [];
      }

      // Resolve category from tool key
      const category = TOOL_CATEGORY_MAP[tool];

      let distinct = 0;
      for (const f of parsed) {
        const fingerprint = computeFingerprint(tool, f.filePath, f.line, f.vulnIdFromTool, f.title);
        if (seenFingerprints.has(fingerprint)) continue; // duplicate report of the same finding
        seenFingerprints.add(fingerprint);
        distinct++;

        const codeSnippet = repoPath ? extractCodeSnippet(repoPath, f.filePath ?? '', f.line) : undefined;
        // PII findings are always Info severity
        const severity = normalizeSeverity(category === 'pii' ? 'Info' : f.severity);
        preparedFindings.push({
          tempId: preparedFindings.length,
          testKey: rf.key,
          title: f.title,
          severity,
          description: f.description || undefined,
          filePath: f.filePath || undefined,
          line: f.line ?? undefined,
          vulnIdFromTool: f.vulnIdFromTool || undefined,
          cwe: f.cwe ?? undefined,
          cvssScore: f.cvssScore ?? undefined,
          tool,
          category,
          codeSnippet,
          secretValue: f.secretValue ?? undefined,
          fingerprint,
        });
      }

      preparedTests.push({
        key: rf.key,
        tool,
        scanType: rf.scanType,
        testTitle: rf.testTitle || undefined,
        fileName: rf.filename,
        // Deduplicated count — this is what the repo page shows per tool,
        // and it must match the findings list (also deduplicated).
        findingsCount: distinct,
      });

      imports.push({ key: rf.key, findingsCount: parsed.length });
    } catch (err) {
      imports.push({ key: rf.key, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // READ-ONLY dedup matching against findings from previous successful scans.
  const matched = await matchExistingFindings(
    repositoryId,
    preparedFindings.map(f => f.fingerprint),
  );
  for (const f of preparedFindings) {
    const existingId = matched.get(f.fingerprint);
    if (existingId != null) f.matchedFindingId = existingId;
  }

  return { resultFiles, preparedTests, preparedFindings, imports };
}

// ── logScanEvent (local helper to avoid circular dep with pipeline.ts) ──

async function logScanEvent(
  scanId: string,
  stepName: string | null,
  level: 'info' | 'warning' | 'error',
  message: string,
  details?: Record<string, unknown>,
  repoName?: string,
  workspaceId?: number | null,
): Promise<void> {
  try {
    await db.insert(scanEvents).values({
      scanId,
      stepName,
      level,
      source: stepName ?? 'import',
      message,
      details: details ?? {},
      repoName: repoName ?? null,
      workspaceId: workspaceId ?? null,
    });
  } catch (err) {
    console.error(`[import] Failed to log scan event for ${scanId}:`, err instanceof Error ? err.message : err);
  }
}

// ── ToolWarning interface (matches security-tools output) ────────

interface ToolWarning {
  tool: string;
  level: 'info' | 'warning';
  message: string;
  details: Record<string, unknown>;
}

// ── runImportStep (unified StepFn wrapper) ───────────────────────
// PREPARE-only step: parses/validates tool outputs, matches dedup candidates
// read-only, and emits a serializable plan in its step output. The plan
// survives pause/resume via scan_steps.output (same as resultFiles always
// did) and is written to the DB by the final 'commit' step.

export async function runImportStep({ ctx, prev }: StepInput): Promise<ImportOutput> {
  // 1. Setup database — resolve workspace/team/repo IDs
  const ids = await setupDatabase(ctx);

  // 2. Log tool warnings from security-tools step
  const toolWarnings = (prev.toolWarnings ?? []) as ToolWarning[];
  for (const w of toolWarnings) {
    await logScanEvent(ctx.scanId, 'security-tools', w.level, w.message, w.details, ctx.repoName, ids.workspaceId);
  }

  // 3. Read + parse results into the import plan (no repo-data writes)
  const resultFiles = await readResults(ctx);
  const importSummary = await prepareImportPlan(ctx.scanId, ids.repositoryId, resultFiles, ctx.repoPath);

  // Log import errors
  for (const imp of importSummary.imports) {
    if (imp.error) {
      await logScanEvent(ctx.scanId, 'import', 'error', `Import failed for ${imp.key}: ${imp.error}`, { tool: imp.key }, ctx.repoName, ids.workspaceId);
    }
  }

  // 4. Extract git-stats locally and merge by contributor
  const rawGitStats = extractGitStats(ctx.repoPath);
  let emailAliases: Record<string, string[]> = {};
  let gitStats = rawGitStats;

  if (rawGitStats.length > 0) {
    const mergeResult = await mergeStatsByContributor(rawGitStats, ids.workspaceId);
    gitStats = mergeResult.merged;
    emailAliases = mergeResult.emailAliases;

    resultFiles.push({
      key: 'git-stats',
      filename: 'git-contributor-stats.json',
      scanType: '_stats',
      testTitle: '',
      content_b64: Buffer.from(JSON.stringify(gitStats)).toString('base64'),
    });
  }

  // 5. Parse analyzer assessments from contributor-assessments.json
  let analyzerAssessments: unknown[] = [];
  try {
    const assessmentsPath = path.join(ctx.agentDir, 'contributor-assessments.json');
    const assessmentsContent = fs.readFileSync(assessmentsPath, 'utf8');
    const parsed = JSON.parse(assessmentsContent);
    if (Array.isArray(parsed)) {
      // Deduplicate feedback text within each assessment (Claude sometimes repeats sections)
      for (const a of parsed as Array<{ email?: string; feedback?: string }>) {
        if (a.feedback) {
          const before = a.feedback.length;
          a.feedback = deduplicateFeedbackText(a.feedback);
          if (a.feedback.length < before) {
            console.log(`[import] Deduped feedback for ${a.email}: ${before} → ${a.feedback.length} chars`);
          }
        }
      }
      analyzerAssessments = parsed;
    }
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      // Assessments file may not exist — that's OK (analyzer step disabled or produced none)
    } else {
      // Corrupt JSON or unreadable file must scream — otherwise developer
      // assessments silently vanish for the whole scan.
      const message = `Failed to read/parse contributor-assessments.json — assessments skipped: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[import] ${message}`);
      await logScanEvent(ctx.scanId, 'import', 'error', message, { file: 'contributor-assessments.json' }, ctx.repoName, ids.workspaceId);
    }
  }

  // 5b. Deduplicate assessments by contributor ID (multiple email aliases → same person)
  if (analyzerAssessments.length > 1) {
    analyzerAssessments = await deduplicateAssessments(analyzerAssessments, ids.workspaceId);
  }

  // 6. NOTHING is ingested here. Contributor stats + analyzer assessments ride
  // along in the step output (git-stats inside resultFiles, assessments below)
  // and are ingested by the commit step only after every step has succeeded.

  // NUL-strip the whole plan: commit inserts these strings into TEXT columns
  // (and the plan is staged into jsonb) — Postgres rejects \u0000 in both.
  return sanitizeForDb({
    repositoryId: ids.repositoryId,
    workspaceId: ids.workspaceId,
    findingsPrepared: importSummary.preparedFindings.length,
    testsPrepared: importSummary.preparedTests.length,
    resultFiles,
    preparedTests: importSummary.preparedTests,
    preparedFindings: importSummary.preparedFindings,
    analyzerAssessments,
    emailAliases,
  });
}
