import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { sshExec, getClaudeRunnerConfig, parseStreamJsonResult, SSHTimeoutError } from '../ssh.ts';
import type { PipelineContext, StepInput, AnalysisOutput } from '../pipeline-types.ts';
import { addScanFile } from '../entities.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS, SOURCE_EXTENSIONS, EXCLUDED_DIRS } from '../pipeline-types.ts';
import { getLanguageInstruction } from '../prompt-languages.ts';
import { db } from '../../db/index.ts';
import { contributorAssessments } from '../../db/schema.ts';
import { findOrCreateContributor } from '../../routes/contributors.ts';

// ── Existing functions (preserved for backward compat) ────────────────────────

export async function checkProfileExists(ctx: PipelineContext): Promise<boolean> {
  const result = await sshExec(
    getClaudeRunnerConfig(),
    `test -f "${ctx.profilePath}" && echo exists || echo missing`,
  );
  return result.stdout.trim() === 'exists';
}

export async function runAnalyzer(ctx: PipelineContext): Promise<{ cost?: number; durationMs?: number; log: string }> {
  const langLine = getLanguageInstruction(ctx.reportLanguage);
  const prompt = [
    langLine,
    `Analyze the repository at ${ctx.repoPath} and write the profile.`,
    '',
    `Input files:`,
    `- repo-metadata.json: ${ctx.agentDir}/repo-metadata.json`,
    `- contributors-to-assess.json: ${ctx.agentDir}/contributors-to-assess.json`,
    '',
    `Output: write profile to ${ctx.profilePath}`,
    '',
    `Rules:`,
    `- Read repo-metadata.json FIRST — all git statistics are already collected there`,
    `- ALWAYS write the profile file, even for tiny repositories`,
    `- Only assess contributors listed in contributors-to-assess.json`,
  ].filter(Boolean).join('\n');
  const command = `echo ${JSON.stringify(prompt)} | claude -p --verbose --append-system-prompt-file /prompts/analyzer.md --output-format stream-json --dangerously-skip-permissions`;

  const result = await sshExec(getClaudeRunnerConfig(), command, {
    inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: AI_MAX_TIMEOUT_MS,
  });

  const { result: parsed, log } = parseStreamJsonResult(result.stdout);

  if (parsed.is_error) {
    const msg = String(parsed.result ?? 'unknown error');
    if (msg.includes('Not logged in')) {
      throw new Error('Claude Code is not authenticated on claude-runner. Run: make auth');
    }
    throw new Error(`Analyzer failed: ${msg}`);
  }

  // stream-json result event is authoritative — don't check exit code if result says success
  return {
    cost: parsed.total_cost_usd as number | undefined,
    durationMs: parsed.duration_ms as number | undefined,
    log,
  };
}

// ── Git metadata ──────────────────────────────────────────────────────────────

export interface GitMetadata {
  commits: number;
  contributors: Array<{ name: string; email: string; commits: number }>;
  branches: string[];
  fileTypeDistribution: Record<string, number>;
  repoSizeKb: number;
  monthlyActivity: Array<{ month: string; commits: number }>;
  churnHotspots: Array<{ file: string; changes: number }>;
  scannableCodeSizeKb: number;
}

function runGit(repoPath: string, args: string): string {
  try {
    return execSync(`git -C "${repoPath}" ${args}`, { encoding: 'utf8', timeout: 30_000 });
  } catch {
    return '';
  }
}

export function collectGitMetadata(repoPath: string): GitMetadata {
  // Total commit count
  const commitCountStr = runGit(repoPath, 'rev-list --count HEAD').trim();
  const commits = parseInt(commitCountStr, 10) || 0;

  // Contributors list (from shortlog)
  const shortlogOutput = runGit(repoPath, 'shortlog -sne --all');
  const contributors: GitMetadata['contributors'] = [];
  for (const line of shortlogOutput.trim().split('\n')) {
    const match = line.trim().match(/^(\d+)\t(.+?)\s+<(.+?)>$/);
    if (!match) continue;
    contributors.push({
      name: match[2],
      email: match[3],
      commits: parseInt(match[1], 10),
    });
  }

  // Branches
  const branchOutput = runGit(repoPath, 'branch -r');
  const branches = branchOutput
    .trim()
    .split('\n')
    .map(b => b.trim().replace(/^origin\//, ''))
    .filter(b => b && !b.startsWith('HEAD'));

  // File type distribution
  const lsFilesOutput = runGit(repoPath, 'ls-files');
  const fileTypeDistribution: Record<string, number> = {};
  for (const filePath of lsFilesOutput.trim().split('\n')) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext) continue;
    fileTypeDistribution[ext] = (fileTypeDistribution[ext] ?? 0) + 1;
  }

  // Repo size (sum of all tracked files via git ls-files + wc)
  let repoSizeKb = 0;
  try {
    const wcOutput = execSync(
      `git -C "${repoPath}" ls-files -z | xargs -0 wc -c 2>/dev/null | tail -1`,
      { encoding: 'utf8', timeout: 30_000 },
    );
    const totalBytes = parseInt(wcOutput.trim().split(/\s+/)[0], 10) || 0;
    repoSizeKb = Math.round(totalBytes / 1024);
  } catch {
    repoSizeKb = 0;
  }

  // Monthly activity (last 12 months)
  const monthlyOutput = runGit(
    repoPath,
    'log --pretty=format:"%ad" --date=format:"%Y-%m" --since="12 months ago"',
  );
  const monthlyCounts: Record<string, number> = {};
  for (const month of monthlyOutput.trim().split('\n')) {
    if (!month) continue;
    monthlyCounts[month] = (monthlyCounts[month] ?? 0) + 1;
  }
  const monthlyActivity = Object.entries(monthlyCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, commits: count }));

  // Churn hotspots (top 10 most-changed files)
  const logNameOnlyOutput = runGit(repoPath, 'log --name-only --pretty=format:""');
  const fileCounts: Record<string, number> = {};
  for (const line of logNameOnlyOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    fileCounts[trimmed] = (fileCounts[trimmed] ?? 0) + 1;
  }
  const churnHotspots = Object.entries(fileCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([file, changes]) => ({ file, changes }));

  // Scannable code size (tracked source files matching SOURCE_EXTENSIONS, excluding EXCLUDED_DIRS)
  let scannableCodeSizeKb = 0;
  try {
    const allFiles = runGit(repoPath, 'ls-files').trim().split('\n');
    const sourceFiles = allFiles.filter(f => {
      if (!f) return false;
      const ext = path.extname(f).toLowerCase();
      if (!SOURCE_EXTENSIONS.includes(ext)) return false;
      const parts = f.split('/');
      return !parts.some(p => EXCLUDED_DIRS.includes(p));
    });
    if (sourceFiles.length > 0) {
      const fileArgs = sourceFiles.map(f => `"${repoPath}/${f}"`).join(' ');
      try {
        const wcOutput = execSync(`wc -c ${fileArgs}`, { encoding: 'utf8', timeout: 30_000 });
        const totalLine = wcOutput.trim().split('\n').pop() ?? '';
        const totalBytes = parseInt(totalLine.trim().split(/\s+/)[0], 10) || 0;
        scannableCodeSizeKb = Math.round(totalBytes / 1024);
      } catch {
        scannableCodeSizeKb = 0;
      }
    }
  } catch {
    scannableCodeSizeKb = 0;
  }

  return {
    commits,
    contributors,
    branches,
    fileTypeDistribution,
    repoSizeKb,
    monthlyActivity,
    churnHotspots,
    scannableCodeSizeKb,
  };
}

// ── Contributors to assess ────────────────────────────────────────────────────

interface ContributorToAssess {
  email: string;
  name: string;
  commits: number;
}

export async function buildContributorsToAssess(ctx: PipelineContext): Promise<ContributorToAssess[]> {
  let shortlogOutput: string;
  try {
    shortlogOutput = execSync(
      `git -C "${ctx.repoPath}" shortlog -sne --all`,
      { encoding: 'utf8', timeout: 30_000 },
    );
  } catch (err) {
    console.error(`[pipeline] Failed to run git shortlog for ${ctx.repoName}:`, err instanceof Error ? err.message : err);
    return [];
  }

  const contribs: ContributorToAssess[] = [];
  for (const line of shortlogOutput.trim().split('\n')) {
    const match = line.trim().match(/^(\d+)\t(.+?)\s+<(.+?)>$/);
    if (!match) continue;
    const commitCount = parseInt(match[1], 10);
    if (commitCount < 10) continue;
    contribs.push({ email: match[3], name: match[2], commits: commitCount });
  }

  if (contribs.length === 0) return [];

  // Deduplicate by contributor ID — multiple email aliases should produce one entry
  const seenContribIds = new Set<number>();
  const toAssess: ContributorToAssess[] = [];
  for (const c of contribs) {
    const contribId = await findOrCreateContributor(c.email, c.name, ctx.workspaceId);
    if (seenContribIds.has(contribId)) continue;
    seenContribIds.add(contribId);

    const existing = await db
      .select({ id: contributorAssessments.id })
      .from(contributorAssessments)
      .where(sql`${contributorAssessments.contributorId} = ${contribId} AND ${contributorAssessments.repoName} = ${ctx.repoName}`)
      .limit(1);
    if (existing.length === 0) {
      toAssess.push(c);
    }
  }

  return toAssess;
}

// ── Step wrapper ──────────────────────────────────────────────────────────────

export async function runAnalysisStep({ ctx }: StepInput): Promise<AnalysisOutput> {
  // 1. Collect git metadata → repo-metadata.json
  const metadataPath = path.join(ctx.agentDir, 'repo-metadata.json');
  const metadata = collectGitMetadata(ctx.repoPath);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  // 2. Build contributors-to-assess.json
  const devsToAssess = await buildContributorsToAssess(ctx);
  fs.writeFileSync(
    path.join(ctx.agentDir, 'contributors-to-assess.json'),
    JSON.stringify(devsToAssess, null, 2),
  );

  // 3. Check profile exists locally (no SSH!)
  const profileExists = fs.existsSync(ctx.profilePath);

  // 4. Run analyzer if needed
  let aiAvailable = true;
  try {
    if (!profileExists) {
      const analyzerResult = await runAnalyzer(ctx);
      await addScanFile({ scanId: ctx.scanId, fileName: 'analysis.log', fileType: 'log-analysis', content: analyzerResult.log });
    }
  } catch (err) {
    aiAvailable = false;
    if (err instanceof SSHTimeoutError && err.stdout) {
      await addScanFile({ scanId: ctx.scanId, fileName: 'analysis.log', fileType: 'log-analysis', content: err.stdout }).catch(() => {});
    }
  }

  return {
    aiAvailable,
    profileGenerated: !profileExists,
    contributorsAssessed: devsToAssess.length,
    metadataPath,
  };
}
