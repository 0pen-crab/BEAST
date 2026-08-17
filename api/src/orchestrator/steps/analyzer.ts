import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { sshExec, sshReadFile, getClaudeRunnerConfig, extractAiUsage, SSHTimeoutError } from '../ssh.ts';
import { checkRateLimitAndPause, RateLimitError } from '../rate-limit.ts';
import type { PipelineContext, StepInput, AnalysisOutput, AiUsage } from '../pipeline-types.ts';
import { addScanFile } from '../entities.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS, SOURCE_EXTENSIONS, EXCLUDED_DIRS } from '../pipeline-types.ts';
import { getLanguageInstruction } from '../prompt-languages.ts';
import { resolveModelFlag } from '../ai-models.ts';
import { runClaudeWithTrace } from '../ai-trace.ts';
import { db } from '../../db/index.ts';
import { contributorAssessments } from '../../db/schema.ts';
import { findOrCreateContributor } from '../../routes/contributors.ts';
import { logScanEvent } from '../events.ts';

// ── Existing functions (preserved for backward compat) ────────────────────────

/** Does a file exist and is non-empty on claude-runner? Used for fail-loud guards. */
export async function checkRemoteFileExists(remotePath: string, cancelSignal?: AbortSignal): Promise<boolean> {
  const result = await sshExec(
    getClaudeRunnerConfig(),
    `test -s "${remotePath}" && echo exists || echo missing`,
    { signal: cancelSignal },
  );
  return result.stdout.trim() === 'exists';
}

export async function checkProfileExists(ctx: PipelineContext): Promise<boolean> {
  const result = await sshExec(
    getClaudeRunnerConfig(),
    `test -f "${ctx.profilePath}" && echo exists || echo missing`,
    { signal: ctx.cancelSignal },
  );
  return result.stdout.trim() === 'exists';
}

export async function runAnalyzer(ctx: PipelineContext): Promise<{ cost?: number; durationMs?: number; log: string; aiUsage?: AiUsage }> {
  const langLine = getLanguageInstruction(ctx.reportLanguage);
  const prompt = [
    langLine,
    `Analyze the repository at ${ctx.repoPath} and write both output files.`,
    '',
    `Input files:`,
    `- repo-metadata.json: ${ctx.agentDir}/repo-metadata.json`,
    `- contributors-to-assess.json: ${ctx.agentDir}/contributors-to-assess.json`,
    '',
    `Output:`,
    `- SCAN_CONTEXT_PATH (agent-only scan context): ${ctx.scanContextPath}`,
    `- PROFILE_PATH (human Repository Profile): ${ctx.profilePath}`,
    `- Assessments: ${ctx.agentDir}/contributor-assessments.json`,
    '',
    `Rules:`,
    `- Read repo-metadata.json FIRST — all git statistics are already collected there`,
    `- ALWAYS write BOTH SCAN_CONTEXT_PATH and PROFILE_PATH, even for tiny repositories`,
    `- ALWAYS write the contributor-assessments.json file, even if the array is empty`,
    `- Only assess contributors listed in contributors-to-assess.json`,
  ].filter(Boolean).join('\n');
  const modelId = resolveModelFlag(ctx.aiModelAnalyzer, 'sonnet');
  const claudeArgs = `-p --model ${modelId} --verbose --append-system-prompt-file /prompts/analyzer.md --output-format stream-json --dangerously-skip-permissions`;

  const { stdout, parsed } = await runClaudeWithTrace({
    scanId: ctx.scanId,
    wave: 'analyzer',
    prompt,
    claudeArgs,
    inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: AI_MAX_TIMEOUT_MS,
    cancelSignal: ctx.cancelSignal,
  });

  if (parsed.is_error) {
    const msg = String(parsed.result ?? 'unknown error');
    if (msg.includes('Not logged in')) {
      throw new Error('Claude Code is not authenticated on claude-runner. Run: make claude-login');
    }
    checkRateLimitAndPause(stdout, msg);
    throw new Error(`Analyzer failed: ${msg}`);
  }

  return {
    cost: parsed.total_cost_usd as number | undefined,
    durationMs: parsed.duration_ms as number | undefined,
    log: stdout,
    aiUsage: extractAiUsage(parsed),
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
  // 1. Collect git metadata → repo-metadata.json (always — used by other steps)
  const metadataPath = path.join(ctx.agentDir, 'repo-metadata.json');
  const metadata = collectGitMetadata(ctx.repoPath);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  // 2. Build contributors-to-assess.json
  const devsToAssess = await buildContributorsToAssess(ctx);
  fs.writeFileSync(
    path.join(ctx.agentDir, 'contributors-to-assess.json'),
    JSON.stringify(devsToAssess, null, 2),
  );

  // Skip AI analysis if disabled in workspace settings
  if (!ctx.aiAnalysisEnabled) {
    console.log(`[analysis] AI analysis disabled for workspace ${ctx.workspaceId}, skipping`);
    return {
      aiAvailable: false,
      profileGenerated: false,
      contributorsAssessed: devsToAssess.length,
      metadataPath,
    };
  }

  // 3. Run analyzer.
  // Stale-state guard first: scan-context.md / repo-profile.md live in the
  // per-REPO base dir shared across scans. If a previous scan's copies survive
  // and this analyzer silently fails to write them, the fail-loud checks below
  // (and the scanner's) would find the STALE files and scan with an outdated
  // module map / trust boundaries. Remove them BEFORE the wave runs so the
  // existence checks verify THIS run's output.
  await sshExec(
    getClaudeRunnerConfig(),
    `rm -f "${ctx.scanContextPath}" "${ctx.profilePath}"`,
    { signal: ctx.cancelSignal },
  );

  const aiAvailable = true;
  let aiUsage: AiUsage | undefined;
  try {
    const analyzerResult = await runAnalyzer(ctx);
    aiUsage = analyzerResult.aiUsage;
    await addScanFile({ scanId: ctx.scanId, fileName: 'analysis.log', fileType: 'log-analysis', content: analyzerResult.log });
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    // SCREAM, persist what we captured, then FAIL THE SCAN. AI analysis is
    // enabled (checked above) — a step that was supposed to run and didn't
    // must never let the scan continue as if nothing happened.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[analysis] Analyzer failed for ${ctx.repoName}: ${msg}`);
    await logScanEvent(
      ctx.scanId, 'analysis', 'error',
      `Analyzer failed — failing the scan (AI analysis is enabled for this workspace): ${msg}`,
      {}, ctx.repoName, ctx.workspaceId,
    );
    if (err instanceof SSHTimeoutError && err.stdout) {
      await addScanFile({ scanId: ctx.scanId, fileName: 'analysis.log', fileType: 'log-analysis', content: err.stdout }).catch(() => {});
    } else {
      await addScanFile({ scanId: ctx.scanId, fileName: 'analysis-error.log', fileType: 'log-analysis', content: msg }).catch(() => {});
    }
    throw err;
  }

  // 4. Persist the human Repository Profile into scan_files (UI reads it from there),
  //    then hard-verify the agent-only scan context exists — the scanner depends on it.
  let profilePersisted = false;
  if (aiAvailable) {
    // 4a. Human profile (UI). Missing/empty is a problem but not fatal — the scan can
    //     still run; scream it to the Events page so it doesn't fail silently.
    try {
      const profileMd = await sshReadFile(getClaudeRunnerConfig(), ctx.profilePath, ctx.cancelSignal);
      if (profileMd && profileMd.trim().length > 0) {
        await addScanFile({
          scanId: ctx.scanId,
          fileName: 'repository-profile.md',
          fileType: 'profile',
          content: profileMd,
        });
        profilePersisted = true;
      } else {
        await logScanEvent(
          ctx.scanId, 'analysis', 'warning',
          `Repository Profile empty or missing at ${ctx.profilePath} — the UI report will be blank`,
          {}, ctx.repoName, ctx.workspaceId,
        );
      }
    } catch (err) {
      await logScanEvent(
        ctx.scanId, 'analysis', 'warning',
        `Failed to read Repository Profile from ${ctx.profilePath}: ${err instanceof Error ? err.message : String(err)}`,
        {}, ctx.repoName, ctx.workspaceId,
      );
    }

    // 4b. Agent-only scan context. The scanner & triage agents read this from disk.
    //     If the analyzer didn't produce it, the scan would proceed blind — FAIL LOUD
    //     instead of silently scanning without security context / module map.
    const scanContextOk = await checkRemoteFileExists(ctx.scanContextPath, ctx.cancelSignal);
    if (!scanContextOk) {
      const errMsg = `Analyzer did not write scan context to ${ctx.scanContextPath} — the scanner has no strategy input. Failing the scan instead of scanning blind.`;
      await logScanEvent(ctx.scanId, 'analysis', 'error', errMsg, {}, ctx.repoName, ctx.workspaceId);
      throw new Error(errMsg);
    }
  }

  return {
    aiAvailable,
    // Honest value: true only when the analyzer ran AND the profile was
    // actually read back non-empty — never claim a profile that doesn't exist.
    profileGenerated: aiAvailable && profilePersisted,
    contributorsAssessed: devsToAssess.length,
    metadataPath,
    aiUsage,
  };
}
