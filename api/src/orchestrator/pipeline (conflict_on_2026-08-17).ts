import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  scans, scanSteps, workspaces, repositories,
  type Scan, type ScanStep,
} from '../db/schema.ts';
import type { PipelineContext, StepDef, ScanStepError } from './pipeline-types.ts';
import { ScanPausedError } from './rate-limit.ts';
import { sanitizeForDb } from '../lib/sanitize.ts';
import { logScanEvent } from './events.ts';
import { clearTraces } from './ai-trace.ts';
import { queueFeedbackCompilation } from './feedback-worker.ts';
import { runCloneStep } from './steps/clone.ts';
import { runAnalysisStep } from './steps/analyzer.ts';
import { runSecToolsStep } from './steps/security-tools.ts';
import { runAiResearchStep } from './steps/scanner.ts';
import { runImportStep } from './steps/import-results.ts';
import { runTriageStep } from './steps/triage-report.ts';
import { runMitigationCheckStep } from './steps/mitigation-check.ts';
import { runCommitStep } from './steps/commit-results.ts';

// Re-export PipelineContext for backward compat (worker.ts, etc.)
export type { PipelineContext } from './pipeline-types.ts';

/** What the pipeline reports back to the worker on a successful run. */
export interface PipelineRunResult {
  /** True when some tools/modules stayed failed after their retry pass —
   *  the scan is still 'completed', but flagged "completed with errors". */
  completedWithErrors: boolean;
  /** The surviving failures, maximally detailed — persisted on the scan row. */
  stepErrors: ScanStepError[];
}

// ── Step definitions ─────────────────────────────────────────
// Array = parallel group. Steps run sequentially unless grouped.

// Steps run sequentially. A nested array runs as a parallel group.
// REQUIRED POLICY: if a feature is enabled in the workspace, its step MUST
// succeed — a step that was supposed to run and didn't fails the whole scan,
// never silently degrades. Steps that have nothing to do MUST return
// successfully without throwing (e.g. security-tools when no tools are
// enabled, analysis when the AI toggle is off).
//
// COMMIT POLICY: repo data (tests, findings, contributor stats/assessments)
// is written ONLY by the final 'commit' step — 'import' merely PREPARES a
// serializable plan and 'triage-report' decides on it. A scan that fails
// before commit leaves no repo data behind (cleanup.ts stays wired as a
// safety net and screams if it ever finds pre-commit data to delete).
const STEPS: (StepDef | StepDef[])[] = [
  { name: 'clone',          run: runCloneStep,      required: true },
  { name: 'analysis',       run: runAnalysisStep,   required: ctx => ctx.aiAnalysisEnabled },
  [
    { name: 'security-tools', run: runSecToolsStep,   required: true },
    { name: 'ai-research',    run: runAiResearchStep, required: ctx => ctx.aiScanningEnabled },
  ],
  { name: 'import',         run: runImportStep,      required: true },
  { name: 'triage-report',  run: runTriageStep,      required: ctx => ctx.aiTriageEnabled },
  // Verified auto-closing of fixed findings — shares the triage toggle: when
  // the workspace trusts AI triage, it trusts AI fix-verification too.
  { name: 'mitigation-check', run: runMitigationCheckStep, required: ctx => ctx.aiTriageEnabled },
  { name: 'commit',         run: runCommitStep,      required: true },
];

function isRequired(step: StepDef, ctx: PipelineContext): boolean {
  return typeof step.required === 'function' ? step.required(ctx) : step.required;
}

// Flat list for step row creation (preserves order)
function flatSteps(): { name: string; order: number }[] {
  let order = 0;
  const result: { name: string; order: number }[] = [];
  for (const entry of STEPS) {
    if (Array.isArray(entry)) {
      for (const s of entry) {
        order++;
        result.push({ name: s.name, order });
      }
    } else {
      order++;
      result.push({ name: entry.name, order });
    }
  }
  return result;
}

// ── Helpers ──────────────────────────────────────────────────

async function updateStepStatus(
  stepId: number,
  status: string,
  updates?: Partial<Pick<ScanStep, 'input' | 'output' | 'error' | 'artifactsPath' | 'startedAt' | 'completedAt'>>,
): Promise<void> {
  // Tool output can carry NUL bytes (binary-ish snippets) which Postgres
  // rejects in jsonb — a single one used to kill the whole scan here.
  await db.update(scanSteps)
    .set(sanitizeForDb({ status, ...updates }))
    .where(eq(scanSteps.id, stepId));
}

async function checkCancelled(scanId: string): Promise<boolean> {
  const [row] = await db.select({ status: scans.status })
    .from(scans)
    .where(eq(scans.id, scanId));
  return row?.status === 'failed';
}

export async function buildContext(scan: Scan): Promise<PipelineContext> {
  const repoUrl = scan.repoUrl || scan.localPath || '';
  const localPath = scan.localPath || '';
  const repoName = scan.repoName;

  // Same-named repos from different sources (e.g. "mountain" on a GitHub org
  // and "mountain" on a GitLab org) must never share a clone dir — key the
  // base path by SOURCE id (ids are globally unique across providers; names
  // are not). Repos without a source fall back to their own repository id.
  let sourceKey = `repo-${scan.repositoryId ?? 0}`;
  if (scan.repositoryId) {
    const [repo] = await db.select({ sourceId: repositories.sourceId })
      .from(repositories)
      .where(eq(repositories.id, scan.repositoryId));
    if (repo?.sourceId != null) sourceKey = `src-${repo.sourceId}`;
  }
  const repoBaseDir = `/workspace/${sourceKey}/${repoName}`;

  let workspaceName: string;
  let cloneUrl: string;
  let repoPath: string;

  if (localPath && !localPath.startsWith('http')) {
    const parts = localPath.replace(/\/+$/, '').split('/');
    workspaceName = parts.length > 1 ? parts[parts.length - 2] : 'local';
    cloneUrl = '';
    repoPath = localPath.startsWith('/') ? localPath : `/local-repos/${localPath}`;
  } else {
    const cleanUrl = repoUrl.replace(/\.git$/, '');
    const urlParts = cleanUrl.split('/');
    workspaceName = urlParts[urlParts.length - 2] || 'unknown';
    cloneUrl = repoUrl;
    repoPath = `${repoBaseDir}/repo`;
  }

  const workDir = `${repoBaseDir}/${scan.id}`;
  const toolsDir = `${workDir}/tools_results`;
  const agentDir = `${workDir}/agent_files`;
  const profilePath = `${repoBaseDir}/repo-profile.md`;
  const scanContextPath = `${repoBaseDir}/scan-context.md`;

  let reportLanguage = 'en';
  let aiAnalysisEnabled = true;
  let aiScanningEnabled = true;
  let aiTriageEnabled = true;
  let aiModelAnalyzer = 'sonnet';
  let aiModelScanner = 'opus';
  let aiModelTriage = 'opus';
  let scanDepth = 500;

  if (scan.workspaceId) {
    const [ws] = await db.select({
      defaultLanguage: workspaces.defaultLanguage,
      aiAnalysisEnabled: workspaces.aiAnalysisEnabled,
      aiScanningEnabled: workspaces.aiScanningEnabled,
      aiTriageEnabled: workspaces.aiTriageEnabled,
      aiModelAnalyzer: workspaces.aiModelAnalyzer,
      aiModelScanner: workspaces.aiModelScanner,
      aiModelTriage: workspaces.aiModelTriage,
      scanDepth: workspaces.scanDepth,
    })
      .from(workspaces)
      .where(eq(workspaces.id, scan.workspaceId));
    if (ws) {
      if (ws.defaultLanguage) reportLanguage = ws.defaultLanguage;
      aiAnalysisEnabled = ws.aiAnalysisEnabled;
      aiScanningEnabled = ws.aiScanningEnabled;
      aiTriageEnabled = ws.aiTriageEnabled;
      aiModelAnalyzer = ws.aiModelAnalyzer;
      aiModelScanner = ws.aiModelScanner;
      aiModelTriage = ws.aiModelTriage;
      if (ws.scanDepth) scanDepth = ws.scanDepth;
    }
  }

  return {
    scanId: scan.id,
    repositoryId: scan.repositoryId ?? 0,
    repoUrl,
    repoName,
    branch: scan.branch || '',
    commitHash: scan.commitHash || '',
    scanType: scan.scanType ?? 'full',
    localPath,
    teamName: '',
    workspaceName,
    workspaceId: scan.workspaceId ?? 0,
    repoBaseDir,
    workDir,
    repoPath,
    toolsDir,
    agentDir,
    resultsDir: toolsDir,
    profilePath,
    scanContextPath,
    cloneUrl,
    reportLanguage,
    aiAnalysisEnabled,
    aiScanningEnabled,
    aiTriageEnabled,
    aiModelAnalyzer,
    aiModelScanner,
    aiModelTriage,
    scanDepth,
  };
}

// ── Step execution ───────────────────────────────────────────

async function executeStep(
  step: StepDef,
  ctx: PipelineContext,
  accumulated: Record<string, unknown>,
  stepRows: { id: number; name: string }[],
): Promise<Record<string, unknown>> {
  const stepId = stepRows.find(s => s.name === step.name)!.id;

  await updateStepStatus(stepId, 'running', {
    startedAt: new Date(),
    input: { ...accumulated } as any,
  });

  try {
    const output = await step.run({ ctx, prev: accumulated });
    await updateStepStatus(stepId, 'completed', {
      completedAt: new Date(),
      output: output as any,
    });
    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ScanPausedError) {
      // Pause is recoverable — leave step in 'pending' so resume re-runs it
      await updateStepStatus(stepId, 'pending', { error: msg });
      await logScanEvent(ctx.scanId, step.name, 'warning', `${step.name} paused: ${msg}`, {}, ctx.repoName, ctx.workspaceId);
    } else {
      await updateStepStatus(stepId, 'failed', {
        completedAt: new Date(),
        error: msg,
      });
      await logScanEvent(ctx.scanId, step.name, 'error', `${step.name} failed: ${msg}`, {}, ctx.repoName, ctx.workspaceId);
    }
    throw err;
  }
}

// ── Pipeline Runner ──────────────────────────────────────────

export async function runPipeline(scan: Scan): Promise<PipelineRunResult> {
  const scanId = scan.id;

  // Cancellation: an AbortController whose signal we propagate through to
  // every SSH/HTTP call. A poller checks the DB every 10s and aborts the
  // controller as soon as the user cancels via UI — long-running SSH sessions
  // (e.g. 30-min Sniper invocations, multi-min Wave 2 categories) tear down
  // within seconds instead of running to natural completion.
  // Lifted above the verification fork so verification scans get the same
  // cancellation behavior — they have their own multi-wave loop that must
  // also abort on user cancel.
  const cancelController = new AbortController();
  const cancelPoller = setInterval(async () => {
    try {
      if (await checkCancelled(scanId) && !cancelController.signal.aborted) {
        cancelController.abort();
        console.log(`[pipeline] Scan ${scanId} cancellation detected — aborting in-flight operations`);
      }
    } catch (err) {
      // Transient DB read failure — the poller retries in 10s, and a down DB
      // is surfaced by /api/health. Console is the only channel available here.
      console.error(`[pipeline] cancel-poller error:`, err instanceof Error ? err.message : err);
    }
  }, 10_000);

  try {
    const ctx = await buildContext(scan);
    ctx.cancelSignal = cancelController.signal;
    return await runPipelineInner(scan, ctx, scanId);
  } finally {
    clearInterval(cancelPoller);
  }
}

async function runPipelineInner(scan: Scan, ctx: PipelineContext, scanId: string): Promise<PipelineRunResult> {

  // Idempotent: load existing scan_steps (for resume) or create them on first run.
  const existingSteps = await db.select().from(scanSteps).where(eq(scanSteps.scanId, scanId));
  const stepRows: { id: number; name: string; status: string }[] = [];

  const defs = flatSteps();
  for (const def of defs) {
    const existing = existingSteps.find(s => s.stepName === def.name);
    if (existing) {
      stepRows.push({ id: existing.id, name: def.name, status: existing.status });
    } else {
      const [row] = await db.insert(scanSteps).values({
        scanId,
        stepName: def.name,
        stepOrder: def.order,
        status: 'pending',
      }).returning({ id: scanSteps.id });
      stepRows.push({ id: row.id, name: def.name, status: 'pending' });
    }
  }

  const isResume = existingSteps.length > 0;

  // Fresh run: drop any stale AI traces left over from a previous attempt with
  // the same scan id, so the dashboard trace viewer doesn't show duplicated
  // waves. Resumed scans keep traces of already-completed waves.
  if (!isResume) {
    await clearTraces(scanId);
  }

  await logScanEvent(
    scanId, null, 'info',
    isResume ? `Scan resumed for ${ctx.repoName}` : `Scan started for ${ctx.repoName}`,
    {}, ctx.repoName, ctx.workspaceId,
  );

  function isCompleted(stepName: string): boolean {
    return stepRows.find(s => s.name === stepName)?.status === 'completed';
  }
  async function loadOutput(stepName: string): Promise<Record<string, unknown>> {
    const id = stepRows.find(s => s.name === stepName)?.id;
    if (!id) return {};
    const [row] = await db.select({ output: scanSteps.output }).from(scanSteps).where(eq(scanSteps.id, id));
    return (row?.output as Record<string, unknown>) ?? {};
  }

  // Accumulated state — each step's output merges into this. On resume, hydrate
  // from previously-completed steps so subsequent steps see prior outputs.
  let accumulated: Record<string, unknown> = {};
  if (isResume) {
    for (const def of defs) {
      if (isCompleted(def.name)) {
        accumulated = { ...accumulated, ...(await loadOutput(def.name)) };
      }
    }
  }

  for (const entry of STEPS) {
    if (await checkCancelled(scanId)) throw new Error('Scan cancelled by user');

    if (Array.isArray(entry)) {
      // Parallel group — run all steps concurrently. Already-completed steps skipped.
      const results = await Promise.allSettled(
        entry.map(step => {
          if (isCompleted(step.name)) {
            return loadOutput(step.name);
          }
          return executeStep(step, ctx, accumulated, stepRows.map(r => ({ id: r.id, name: r.name })))
            .catch(err => {
              if (err instanceof ScanPausedError || isRequired(step, ctx)) throw err;
              // Non-required step failure: log and return empty output
              return {} as Record<string, unknown>;
            });
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          accumulated = { ...accumulated, ...r.value };
        }
      }

      // Check if any parallel step failed fatally (required or paused)
      for (let i = 0; i < entry.length; i++) {
        if (results[i].status === 'rejected') {
          const reason = (results[i] as PromiseRejectedResult).reason;
          if (reason instanceof ScanPausedError || isRequired(entry[i], ctx)) throw reason;
        }
      }
    } else {
      // Sequential step
      if (isCompleted(entry.name)) {
        accumulated = { ...accumulated, ...(await loadOutput(entry.name)) };
        continue;
      }
      try {
        const output = await executeStep(entry, ctx, accumulated, stepRows.map(r => ({ id: r.id, name: r.name })));
        accumulated = { ...accumulated, ...output };
      } catch (err) {
        if (err instanceof ScanPausedError || isRequired(entry, ctx)) throw err;
        // Non-required step failure — continue
      }
    }
  }

  // Every step succeeded — only now queue developer-profile (feedback)
  // compilation for contributors assessed in this scan. A failed scan must
  // not leave partial side effects like half-updated profiles.
  // assessedContributorIds comes from the COMMIT step's output — assessments
  // land in the DB only there, after all steps succeeded.
  const assessedIds = (accumulated.assessedContributorIds as number[] | undefined) ?? [];
  for (const contribId of new Set(assessedIds)) {
    queueFeedbackCompilation(contribId);
  }

  // "Completed with errors": collect the surviving (post-retry) failures the
  // steps reported in their outputs — security-tools → toolErrors, ai-research
  // → moduleErrors. The scan still completes (succeeded tools/modules WERE
  // committed — that's the point), but the worker flags it and persists the
  // structured details for the UI.
  const toolErrors = (accumulated.toolErrors as ScanStepError[] | undefined) ?? [];
  const moduleErrors = (accumulated.moduleErrors as ScanStepError[] | undefined) ?? [];
  const stepErrors: ScanStepError[] = [...toolErrors, ...moduleErrors];

  if (stepErrors.length > 0) {
    const summary = stepErrors
      .map(e => e.kind === 'module' ? `module ${e.name} (${e.error})` : `${e.name} (${e.error})`)
      .join('; ');
    await logScanEvent(
      scanId, null, 'warning',
      `Scan completed with errors: ${summary}`,
      { stepErrors },
      ctx.repoName, ctx.workspaceId,
    );
  } else {
    await logScanEvent(scanId, null, 'info', `Scan completed for ${ctx.repoName}`, {}, ctx.repoName, ctx.workspaceId);
  }

  return { completedWithErrors: stepErrors.length > 0, stepErrors };
}
