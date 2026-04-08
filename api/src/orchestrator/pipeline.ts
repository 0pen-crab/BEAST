import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  scans, scanSteps, scanEvents, workspaces,
  type Scan, type ScanStep,
} from '../db/schema.ts';
import type { PipelineContext, StepDef } from './pipeline-types.ts';
import { RateLimitError } from './rate-limit.ts';
import { runCloneStep } from './steps/clone.ts';
import { runAnalysisStep } from './steps/analyzer.ts';
import { runSecToolsStep } from './steps/security-tools.ts';
import { runAiResearchStep } from './steps/scanner.ts';
import { runImportStep } from './steps/import-results.ts';
import { runTriageStep } from './steps/triage-report.ts';

// Re-export PipelineContext for backward compat (worker.ts, etc.)
export type { PipelineContext } from './pipeline-types.ts';

// ── Step definitions ─────────────────────────────────────────
// Array = parallel group. Steps run sequentially unless grouped.

const STEPS: (StepDef | StepDef[])[] = [
  { name: 'clone',          run: runCloneStep,      required: true },
  { name: 'analysis',       run: runAnalysisStep,   required: false },
  [
    { name: 'security-tools', run: runSecToolsStep,   required: false },
    { name: 'ai-research',    run: runAiResearchStep, required: false },
  ],
  { name: 'import',         run: runImportStep,      required: true },
  { name: 'triage-report',  run: runTriageStep,      required: false },
];

// Flat list for step row creation (preserves order)
function flatSteps(): { name: string; order: number; required: boolean }[] {
  let order = 0;
  const result: { name: string; order: number; required: boolean }[] = [];
  for (const entry of STEPS) {
    if (Array.isArray(entry)) {
      for (const s of entry) {
        order++;
        result.push({ name: s.name, order, required: s.required });
      }
    } else {
      order++;
      result.push({ name: entry.name, order, required: entry.required });
    }
  }
  return result;
}

// ── Helpers ──────────────────────────────────────────────────

export async function logScanEvent(
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
      source: stepName ?? 'pipeline',
      message,
      details: details ?? {},
      repoName: repoName ?? null,
      workspaceId: workspaceId ?? null,
    });
  } catch (err) {
    console.error(`[pipeline] Failed to log scan event for ${scanId}:`, err instanceof Error ? err.message : err);
  }
}

async function updateStepStatus(
  stepId: number,
  status: string,
  updates?: Partial<Pick<ScanStep, 'input' | 'output' | 'error' | 'artifactsPath' | 'startedAt' | 'completedAt'>>,
): Promise<void> {
  await db.update(scanSteps)
    .set({ status, ...updates })
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
    repoPath = `/workspace/${repoName}/repo`;
  }

  const workDir = `/workspace/${repoName}/${scan.id}`;
  const toolsDir = `${workDir}/tools_results`;
  const agentDir = `${workDir}/agent_files`;
  const profilePath = `${agentDir}/repo-profile.md`;

  let reportLanguage = 'en';
  let aiAnalysisEnabled = true;
  let aiScanningEnabled = true;
  let aiTriageEnabled = true;

  if (scan.workspaceId) {
    const [ws] = await db.select({
      defaultLanguage: workspaces.defaultLanguage,
      aiAnalysisEnabled: workspaces.aiAnalysisEnabled,
      aiScanningEnabled: workspaces.aiScanningEnabled,
      aiTriageEnabled: workspaces.aiTriageEnabled,
    })
      .from(workspaces)
      .where(eq(workspaces.id, scan.workspaceId));
    if (ws) {
      if (ws.defaultLanguage) reportLanguage = ws.defaultLanguage;
      aiAnalysisEnabled = ws.aiAnalysisEnabled;
      aiScanningEnabled = ws.aiScanningEnabled;
      aiTriageEnabled = ws.aiTriageEnabled;
    }
  }

  return {
    scanId: scan.id,
    repoUrl,
    repoName,
    branch: scan.branch || '',
    commitHash: scan.commitHash || '',
    localPath,
    teamName: '',
    workspaceName,
    workspaceId: scan.workspaceId ?? 0,
    workDir,
    repoPath,
    toolsDir,
    agentDir,
    resultsDir: toolsDir,
    profilePath,
    cloneUrl,
    reportLanguage,
    aiAnalysisEnabled,
    aiScanningEnabled,
    aiTriageEnabled,
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
    await updateStepStatus(stepId, 'failed', {
      completedAt: new Date(),
      error: msg,
    });
    await logScanEvent(ctx.scanId, step.name, 'error', `${step.name} failed: ${msg}`, {}, ctx.repoName, ctx.workspaceId);
    throw err;
  }
}

// ── Pipeline Runner ──────────────────────────────────────────

export async function runPipeline(scan: Scan): Promise<void> {
  const ctx = await buildContext(scan);
  const scanId = scan.id;

  // Create all step rows as 'pending'
  const defs = flatSteps();
  const stepRows: { id: number; name: string }[] = [];
  for (const def of defs) {
    const [row] = await db.insert(scanSteps).values({
      scanId,
      stepName: def.name,
      stepOrder: def.order,
      status: 'pending',
    }).returning({ id: scanSteps.id });
    stepRows.push({ id: row.id, name: def.name });
  }

  await logScanEvent(scanId, null, 'info', `Scan started for ${ctx.repoName}`, {}, ctx.repoName, ctx.workspaceId);

  // Accumulated state — each step's output merges into this
  let accumulated: Record<string, unknown> = {};

  for (const entry of STEPS) {
    if (await checkCancelled(scanId)) throw new Error('Scan cancelled by user');

    if (Array.isArray(entry)) {
      // Parallel group — run all steps concurrently
      const results = await Promise.allSettled(
        entry.map(step =>
          executeStep(step, ctx, accumulated, stepRows)
            .catch(err => {
              if (err instanceof RateLimitError || step.required) throw err;
              // Non-required step failure: log and return empty output
              return {} as Record<string, unknown>;
            }),
        ),
      );

      // Merge successful outputs into accumulated
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          accumulated = { ...accumulated, ...r.value };
        }
      }

      // Check if any parallel step failed fatally (required or rate limit)
      for (let i = 0; i < entry.length; i++) {
        if (results[i].status === 'rejected') {
          const reason = (results[i] as PromiseRejectedResult).reason;
          if (reason instanceof RateLimitError || entry[i].required) throw reason;
        }
      }
    } else {
      // Sequential step
      try {
        const output = await executeStep(entry, ctx, accumulated, stepRows);
        accumulated = { ...accumulated, ...output };
      } catch (err) {
        if (err instanceof RateLimitError || entry.required) throw err;
        // Non-required step failure — continue
      }
    }
  }

  await logScanEvent(scanId, null, 'info', `Scan completed for ${ctx.repoName}`, {}, ctx.repoName, ctx.workspaceId);
}
