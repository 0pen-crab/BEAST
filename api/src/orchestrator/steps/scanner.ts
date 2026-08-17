import { sshExec, sshWriteFile, getClaudeRunnerConfig, extractAiUsage, buildAgentMetric, formatAgentMetric, SSHTimeoutError } from '../ssh.ts';
import { runClaudeWithTrace } from '../ai-trace.ts';
import type { AgentMetric } from '../ssh.ts';
import { checkRateLimitAndPause, ScanPausedError } from '../rate-limit.ts';
import type { PipelineContext, StepInput, AiResearchOutput, AiUsage, ScanStepError } from '../pipeline-types.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS } from '../pipeline-types.ts';
import { getLanguageInstruction } from '../prompt-languages.ts';
import { resolveModelFlag } from '../ai-models.ts';
import { addScanFile } from '../entities.ts';
import { logScanEvent } from '../events.ts';
import { checkRemoteFileExists } from './analyzer.ts';
import {
  ensureScanModule,
  listScanModules,
  markScanModuleRunning,
  markScanModuleCompleted,
  markScanModulePending,
  markScanModuleFailed,
} from '../scan-modules.ts';
import { buildMirror } from './mirror-builder.ts';
import { preClassifyAll, type ClassifiedFile } from './pre-classifier.ts';
import { partition, type PartitionModule } from './partitioner.ts';

// ══════════════════════════════════════════════════════════════════════════════
// Pipeline (linguist-based, Scout only for UNCLEAR):
//   1. Mirror + metadata (Python script on claude-runner)
//   2. Pre-classifier (deterministic, linguist + hard rules)
//   3. Scout UNCLEAR resolver (Sonnet, batches of 500) — skipped when no UNCLEAR files
//   4. Algorithmic partitioner (TS)
//   5. Sniper (Opus 1M, per module, sequential) — modules up to 1000 files
//   6. Merge partials → SARIF
//
// Design choices (from T14 benchmark):
//   - No INTERESTING verifier: linguist caught 99.97% correctly (2/6278 false positives),
//     not worth the per-batch overhead.
//   - Large Sniper modules: Opus 1M has room for ~1000 source files at ~30-40% util;
//     fewer modules means less fixed overhead (cache writes) and lower total cost.
// ══════════════════════════════════════════════════════════════════════════════

const UNCLEAR_BATCH_SIZE = 500;
// Sniper module sizing:
//   - target: from workspace.scan_depth (1500 / 500 / 100). Each module gets
//             roughly this many files.
//   - max:    target * 1.5 — only split a directory when it strictly exceeds
//             this. Ensures a 150-file repo at target=100 stays as one module
//             instead of fracturing into 100+50.

interface ClaudeInvocation {
  parsed: Record<string, unknown>;
  log: string;
  usage?: AiUsage;
  durationMs: number;
  /** CLI --model value the wave was actually launched with (may carry '[1m]') */
  modelId: string;
}

/**
 * Custom error that carries the raw Claude stdout so callers can persist it
 * for diagnostics. The generic "No result event found in stream output" error
 * loses this information unless we propagate it explicitly.
 */
export class ClaudeInvocationError extends Error {
  public readonly stdout: string;
  public readonly tail: string;

  constructor(message: string, stdout: string) {
    super(message);
    this.name = 'ClaudeInvocationError';
    this.stdout = stdout;
    // Last 2KB usually contains the failure cause
    this.tail = stdout.length > 2048 ? '...' + stdout.slice(-2048) : stdout;
  }
}

async function runClaudeWithPrompt(
  scanId: string,
  wave: string,
  userPrompt: string,
  systemPromptFile: string,
  modelKey: string,
  fallback: 'opus' | 'sonnet' | 'haiku',
  timeoutMs: number,
  cancelSignal?: AbortSignal,
): Promise<ClaudeInvocation> {
  const modelId = resolveModelFlag(modelKey, fallback);
  const claudeArgs = `-p --model ${modelId} --verbose --append-system-prompt-file ${systemPromptFile} --output-format stream-json --dangerously-skip-permissions`;

  const started = Date.now();
  const { stdout, parsed } = await runClaudeWithTrace({
    scanId,
    wave,
    prompt: userPrompt,
    claudeArgs,
    inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: timeoutMs,
    cancelSignal,
  });
  const durationMs = Date.now() - started;

  if (parsed.is_error) {
    const msg = String(parsed.result ?? 'unknown error');
    if (msg.includes('Not logged in')) {
      throw new ClaudeInvocationError('Claude Code is not authenticated on claude-runner. Run: make claude-login', stdout);
    }
    checkRateLimitAndPause(stdout, msg);
    throw new ClaudeInvocationError(`Claude failed: ${msg}`, stdout);
  }

  return { parsed, log: stdout, usage: extractAiUsage(parsed), durationMs, modelId };
}

// ── Path helpers ─────────────────────────────────────────────────────────────

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80).toLowerCase();
}

function classifiedMetadataPath(ctx: PipelineContext): string {
  return `${ctx.agentDir}/classified-metadata.jsonl`;
}

function scoutBatchPath(ctx: PipelineContext, idx: number): string {
  return `${ctx.agentDir}/scout-unclear-batch-${idx}.json`;
}

function scoutOutputPath(ctx: PipelineContext, idx: number): string {
  return `${ctx.agentDir}/scout-unclear-result-${idx}.json`;
}

/**
 * Path for a module's partial findings file. The module INDEX is part of the
 * name: safeName lowercases + truncates to 80 chars, so two different modules
 * (e.g. `src/API` vs `src/api`, or long names sharing an 80-char prefix) can
 * collapse to the same safe name — without the index one would silently
 * overwrite the other's findings. Exported for tests.
 */
export function partialOutputPath(ctx: PipelineContext, moduleIndex: number, moduleName: string): string {
  return `${ctx.agentDir}/partial-${moduleIndex}-${safeName(moduleName)}.json`;
}

// ── JSON-from-SSH helper ─────────────────────────────────────────────────────

async function readJsonFromRemote<T>(path: string, cancelSignal?: AbortSignal): Promise<T | null> {
  try {
    const res = await sshExec(getClaudeRunnerConfig(), `cat ${JSON.stringify(path)} 2>/dev/null`, { signal: cancelSignal });
    const content = res.stdout.trim();
    if (!content) return null;
    let jsonStr = content;
    const fenced = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fenced) jsonStr = fenced[1];
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    console.error(`[scanner] Failed to read JSON from ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// Stage 3: Scout UNCLEAR resolver
// ══════════════════════════════════════════════════════════════════════════════

interface ScoutResult {
  interesting: string[];
  trash: string[];
}

async function runScoutBatch(
  ctx: PipelineContext,
  kind: 'unclear',
  batchFiles: ClassifiedFile[],
  batchIdx: number,
  totalBatches: number,
  mirrorPath: string,
  metrics: AgentMetric[],
): Promise<ScoutResult> {
  const batchPath = scoutBatchPath(ctx, batchIdx);
  const outPath = scoutOutputPath(ctx, batchIdx);

  // Resume-correctness: scout-unclear is deterministic for a given batch (same files
  // → same classifications), so on a rate-limit resume we'd otherwise burn ~5-15min
  // and ~$0.3-1.6 per batch re-calling Claude for the same answer. Each Claude call
  // also chews a chunk of the new 5h rate-limit window, leaving less room for the
  // Sniper modules that actually drive progress. Check for a persisted result first.
  const cached = await readJsonFromRemote<ScoutResult>(outPath, ctx.cancelSignal);
  if (cached && Array.isArray(cached.interesting) && Array.isArray(cached.trash)) {
    console.log(`[scanner] Scout unclear ${batchIdx + 1}/${totalBatches} — using cached result (${cached.interesting.length} INTERESTING / ${cached.trash.length} TRASH)`);
    return cached;
  }

  const manifest = batchFiles.map(f => ({
    path: f.path,
    size_bytes: f.size_bytes,
    line_count: f.line_count,
    ext: f.ext,
    avg_line_length: f.avg_line_length,
    is_binary: f.is_binary,
  }));
  await sshWriteFile(getClaudeRunnerConfig(), batchPath, JSON.stringify(manifest), ctx.cancelSignal);

  const langLine = getLanguageInstruction(ctx.reportLanguage);
  const userPrompt = [
    langLine,
    `Classify UNCLEAR batch ${batchIdx + 1}/${totalBatches} (${batchFiles.length} files).`,
    '',
    `BATCH_PATH: ${batchPath}`,
    `OUTPUT_PATH: ${outPath}`,
    `MIRROR_PATH: ${mirrorPath}`,
    '',
    `Read batch manifest, classify each file, write results to OUTPUT_PATH.`,
  ].filter(Boolean).join('\n');

  console.log(`[scanner] Scout unclear ${batchIdx + 1}/${totalBatches} (${batchFiles.length} files)`);

  const inv = await runClaudeWithPrompt(ctx.scanId, `scout-unclear-${batchIdx + 1}`, userPrompt, '/prompts/scanner-scout-unclear.md', 'sonnet', 'sonnet', AI_MAX_TIMEOUT_MS, ctx.cancelSignal);
  if (inv.usage) {
    const m = buildAgentMetric(`scout-unclear:${batchIdx}`, inv.usage, inv.durationMs, inv.modelId);
    metrics.push(m);
    console.log(`[scanner] ${formatAgentMetric(m, ctx.scanId)}`);
  }

  const out = await readJsonFromRemote<ScoutResult>(outPath, ctx.cancelSignal);
  if (!out || !Array.isArray(out.interesting) || !Array.isArray(out.trash)) {
    const warnMsg = `Scout unclear batch ${batchIdx + 1}/${totalBatches} produced no valid output — treating all ${batchFiles.length} files as INTERESTING (fail-safe; increases Sniper scope and cost)`;
    console.error(`[scanner] ${warnMsg}`);
    await logScanEvent(
      ctx.scanId, 'ai-research', 'warning', warnMsg,
      { batch: batchIdx + 1, totalBatches, files: batchFiles.length, outputPath: outPath },
      ctx.repoName, ctx.workspaceId,
    );
    return { interesting: batchFiles.map(f => f.path), trash: [] };
  }
  console.log(`[scanner] Scout unclear batch ${batchIdx} → ${out.interesting.length} INTERESTING / ${out.trash.length} TRASH`);
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// Stage 6: Sniper
// ══════════════════════════════════════════════════════════════════════════════

async function runSniperForModule(
  ctx: PipelineContext,
  module: PartitionModule,
  index: number,
  total: number,
  metrics: AgentMetric[],
  isRetry = false,
): Promise<void> {
  const outPath = partialOutputPath(ctx, index, module.name);
  console.log(`[scanner] Sniper ${index + 1}/${total} "${module.name}"${isRetry ? ' [retry]' : ''} (${module.interesting.length} INTERESTING, ${module.docs.length} DOCS)`);

  if (module.interesting.length === 0) {
    await sshWriteFile(getClaudeRunnerConfig(), outPath, '[]', ctx.cancelSignal);
    return;
  }

  const interestingLines = module.interesting.map(p => `- ${p}`).join('\n');
  const docsLines = module.docs.length > 0
    ? '\n\nDOCS (reference context — read on demand when uncertain about intent):\n' + module.docs.map(p => `- ${p}`).join('\n')
    : '';

  const langLine = getLanguageInstruction(ctx.reportLanguage);
  const userPrompt = [
    langLine,
    `Deep vulnerability scan for module: ${module.name}`,
    '',
    `REPO_PATH: ${ctx.repoPath}`,
    `SCAN_CONTEXT_PATH: ${ctx.scanContextPath}`,
    `PARTIAL_OUTPUT_PATH: ${outPath}`,
    '',
    `Files to scan (absolute scope — do not scan files outside this list):`,
    interestingLines + docsLines,
    '',
    `Follow system prompt. Read each INTERESTING file fully, find vulnerabilities, write JSON array to PARTIAL_OUTPUT_PATH.`,
  ].filter(Boolean).join('\n');

  // Index-prefixed like the partial path — two same-safeName modules must not
  // share a trace name either. The retry pass gets its own '-retry' wave name:
  // persistTrace/addScanFile dedupes by name, so without the suffix the retry
  // trace would silently overwrite the first attempt's (failed) trace and we'd
  // lose the diagnostic story of WHY attempt 1 died.
  const wave = `sniper-${index}-${safeName(module.name)}${isRetry ? '-retry' : ''}`;
  const inv = await runClaudeWithPrompt(ctx.scanId, wave, userPrompt, '/prompts/scanner-sniper.md', 'opus', 'opus', AI_MAX_TIMEOUT_MS, ctx.cancelSignal);
  if (inv.usage) {
    const m = buildAgentMetric(`sniper:${index}-${safeName(module.name)}${isRetry ? '-retry' : ''}`, inv.usage, inv.durationMs, inv.modelId);
    metrics.push(m);
    console.log(`[scanner] ${formatAgentMetric(m, ctx.scanId)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Stage 7: Merge partials → SARIF
// ══════════════════════════════════════════════════════════════════════════════

async function mergePartialsToSarif(ctx: PipelineContext): Promise<number> {
  const lsResult = await sshExec(getClaudeRunnerConfig(), `ls ${ctx.agentDir}/partial-*.json 2>/dev/null || true`, { signal: ctx.cancelSignal });
  const files = lsResult.stdout.trim().split('\n').filter(Boolean);

  const allFindings: Array<Record<string, unknown>> = [];
  for (const filePath of files) {
    const parsed = await readJsonFromRemote<unknown[]>(filePath, ctx.cancelSignal);
    if (Array.isArray(parsed)) allFindings.push(...(parsed as Record<string, unknown>[]));
  }

  console.log(`[scanner] Merged ${allFindings.length} findings from ${files.length} partial files`);

  const sarif = buildSarif(allFindings);
  await sshWriteFile(getClaudeRunnerConfig(), `${ctx.resultsDir}/code-analysis.sarif`, JSON.stringify(sarif, null, 2), ctx.cancelSignal);
  return allFindings.length;
}

function buildSarif(findings: Array<Record<string, unknown>>): Record<string, unknown> {
  const rulesMap = new Map<string, Record<string, unknown>>();
  const results: Array<Record<string, unknown>> = [];

  for (const f of findings) {
    const title = String(f.title || 'Unknown');
    const cwe = String(f.cwe || '');
    const severity = String(f.severity || 'medium').toLowerCase();
    const ruleId = cwe
      ? `${cwe}/${title.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60)}`
      : `BEAST/${title.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60)}`;

    let level = 'warning';
    let secSev = '4.0';
    if (severity === 'critical') { level = 'error'; secSev = '9.0'; }
    else if (severity === 'high') { level = 'error'; secSev = '7.0'; }
    else if (severity === 'low') { level = 'note'; secSev = '1.0'; }

    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        name: title,
        shortDescription: { text: title },
        fullDescription: { text: String(f.description || title) },
        properties: { 'security-severity': secSev },
      });
    }

    results.push({
      ruleId,
      level,
      message: { text: String(f.description || title) },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: String(f.file || '') },
          region: {
            startLine: Number(f.startLine) || 1,
            endLine: Number(f.endLine) || Number(f.startLine) || 1,
            snippet: f.snippet ? { text: String(f.snippet) } : undefined,
          },
        },
      }],
    });
  }

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'BEAST AI Scanner',
          version: '2.0.0',
          rules: Array.from(rulesMap.values()),
        },
      },
      results,
    }],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Metrics summary
// ══════════════════════════════════════════════════════════════════════════════

function summarizeMetrics(metrics: AgentMetric[], classifyCounts: Record<string, number>, moduleCount: number): string {
  const lines: string[] = [];
  lines.push(`=== Scanner Run Summary ===`);
  lines.push(`Pre-classification: ${JSON.stringify(classifyCounts)}`);
  lines.push(`Modules: ${moduleCount}`);
  lines.push(`Total agent invocations: ${metrics.length}`);

  let totalCost = 0;
  let totalDuration = 0;
  const byType = new Map<string, { count: number; cost: number; peakUtil: number; peakCtx: number }>();

  for (const m of metrics) {
    totalCost += m.costUSD;
    totalDuration += m.durationMs;
    const type = m.agent.split(':')[0];
    const bucket = byType.get(type) || { count: 0, cost: 0, peakUtil: 0, peakCtx: 0 };
    bucket.count += 1;
    bucket.cost += m.costUSD;
    // Unknown-model metrics have no utilization — they must not poison the peak with NaN.
    bucket.peakUtil = Math.max(bucket.peakUtil, m.utilizationPct ?? 0);
    bucket.peakCtx = Math.max(bucket.peakCtx, m.totalContext);
    byType.set(type, bucket);
  }

  lines.push(`Total cost: $${totalCost.toFixed(4)}`);
  lines.push(`Total duration: ${(totalDuration / 60_000).toFixed(1)} min`);
  lines.push('');
  lines.push(`By agent type:`);
  for (const [type, b] of byType) {
    lines.push(
      `  ${type.padEnd(20)} count=${b.count} cost=$${b.cost.toFixed(4)} ` +
      `peakCtx=${(b.peakCtx / 1000).toFixed(0)}K peakUtil=${b.peakUtil.toFixed(1)}%`,
    );
  }
  lines.push('');
  lines.push(`Per-agent details:`);
  for (const m of metrics) lines.push(`  ${formatAgentMetric(m)}`);
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// Orchestration
// ══════════════════════════════════════════════════════════════════════════════

async function runPipeline(ctx: PipelineContext, startTime: number): Promise<AiResearchOutput> {
  const metrics: AgentMetric[] = [];

  // Stage 1: Mirror
  const mirror = await buildMirror(ctx);

  // Stage 2: Pre-classify (deterministic)
  const classifiedPath = classifiedMetadataPath(ctx);
  const { files: classified, counts } = await preClassifyAll(mirror.metadataPath, classifiedPath, ctx.cancelSignal);
  console.log(`[scanner] Pre-classify counts: ${JSON.stringify(counts)}`);

  // Silent-corruption guard: the mirror saw files but classification produced
  // nothing — the scan would otherwise "complete" with zero modules and zero
  // AI findings. Fail loud instead.
  if (classified.length === 0 && mirror.fileCount > 0) {
    throw new Error(
      `Pre-classifier produced 0 files but the mirror contains ${mirror.fileCount} — refusing to complete a scan with zero modules`,
    );
  }

  // Stage 3: Scout UNCLEAR (Sonnet, batches of 500)
  const unclearFiles = classified.filter(f => f.bucket === 'UNCLEAR');
  const unclearPromotedPaths = new Set<string>();
  const unclearBatches = chunk(unclearFiles, UNCLEAR_BATCH_SIZE);
  for (let i = 0; i < unclearBatches.length; i++) {
    const result = await runScoutBatch(ctx, 'unclear', unclearBatches[i], i, unclearBatches.length, mirror.mirrorPath, metrics);
    for (const p of result.interesting) unclearPromotedPaths.add(p);
  }

  // Apply scout decisions to the classified list (UNCLEAR → INTERESTING or TRASH)
  const finalFiles: ClassifiedFile[] = classified.map(f => {
    if (f.bucket === 'UNCLEAR') {
      return { ...f, bucket: unclearPromotedPaths.has(f.path) ? 'INTERESTING' : 'TRASH', reason: `scout-unclear` };
    }
    return f;
  });

  // Stage 4: Partition
  const target = ctx.scanDepth ?? 1500;
  const { modules, counts: partCounts } = partition(finalFiles, {
    targetFilesPerModule: target,
    maxFilesPerModule: Math.ceil(target * 1.5),
  });
  console.log(`[scanner] Partitioned into ${modules.length} modules (${partCounts.interesting} INTERESTING, ${partCounts.docs} DOCS)`);

  // Stage 5: Sniper per module — resumable. Each module is checkpointed in
  // scan_modules; on rate-limit we mark it 'pending' and propagate ScanPausedError
  // up to the worker, which sets scan.status='paused'. On resume, completed
  // modules are skipped.
  const persistedModules = await listScanModules(ctx.scanId);
  const modulesByIndex = new Map(persistedModules.map(m => [m.moduleIndex, m]));

  // Track per-module outcomes so we can decide whether to fail the whole step
  // or proceed to merge with whatever partials we have.
  let succeeded = 0;
  const firstPassFailures: Array<{ index: number; rowId: number; mod: PartitionModule; error: string }> = [];

  /**
   * One Sniper attempt for a module (row already marked running by the caller).
   * Returns the failure detail on a non-pause error, null on success.
   * ScanPausedError propagates (resumable interrupt — worker checkpoints).
   */
  async function attemptSniperModule(
    mod: PartitionModule,
    index: number,
    rowId: number,
    isRetry: boolean,
  ): Promise<string | null> {
    try {
      await runSniperForModule(ctx, mod, index, modules.length, metrics, isRetry);
      await markScanModuleCompleted(rowId);
      return null;
    } catch (err) {
      // ScanPausedError (rate limit) is a clean, resumable interrupt — propagate
      // it so the worker can checkpoint and retry. Other errors are isolated to
      // this module.
      if (err instanceof ScanPausedError) {
        await markScanModulePending(rowId, err.message);
        throw err;
      }
      // Persist Claude's raw stdout for diagnosis. Without this we lose visibility
      // into WHY the Sniper failed (timeout, OOM, rate-limit-without-error-event, etc.).
      // Retry attempts get their own '-retry' fail-log so attempt 1's log survives.
      if (err instanceof ClaudeInvocationError) {
        await addScanFile({
          scanId: ctx.scanId,
          fileName: `sniper-${index}-${safeName(mod.name)}${isRetry ? '-retry' : ''}-fail.log`,
          fileType: 'log-sniper-fail',
          content: err.stdout,
        }).catch((e) => console.error(`[scanner] Failed to persist fail-log:`, e));
      }
      const msg = err instanceof Error ? err.message : String(err);
      const tail = err instanceof ClaudeInvocationError ? err.tail : '';
      const detail = tail ? `${msg}\n--- last 2KB of Claude stdout ---\n${tail}` : msg;
      await markScanModuleFailed(rowId, isRetry ? `failed after retry: ${detail}` : detail);
      return detail;
    }
  }

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    let row = modulesByIndex.get(i);
    if (!row) {
      row = await ensureScanModule({
        scanId: ctx.scanId,
        moduleIndex: i,
        moduleName: mod.name,
        fileCount: mod.interesting.length,
        outputPath: partialOutputPath(ctx, i, mod.name),
      });
    }

    if (row.status === 'completed') {
      console.log(`[scanner] Sniper ${i + 1}/${modules.length} "${mod.name}" — skipped (already completed)`);
      succeeded++;
      continue;
    }

    await markScanModuleRunning(row.id);
    const failure = await attemptSniperModule(mod, i, row.id, false);
    if (failure === null) {
      succeeded++;
    } else {
      // Maintainer policy: failed modules are retried NOT immediately but at
      // the very end of the step, after all other modules finished. Queue it.
      firstPassFailures.push({ index: i, rowId: row.id, mod, error: failure });
      console.error(`[scanner] Sniper module "${mod.name}" failed: ${failure.split('\n')[0]}. Will retry at the end of the step.`);
      await logScanEvent(
        ctx.scanId,
        'ai-research',
        'warning',
        `Sniper module "${mod.name}" failed — it will be retried at the end of the step, after all other modules`,
        { module: mod.name, fileCount: mod.interesting.length, error: failure.split('\n')[0] },
        ctx.repoName,
        ctx.workspaceId,
      );
    }
  }

  // Retry pass: one more attempt for every failed module, at the very end.
  // Modules that still fail are collected as structured errors — the step does
  // NOT throw for them; the scan finishes as "completed with errors".
  const moduleErrors: ScanStepError[] = [];
  if (firstPassFailures.length > 0) {
    console.log(`[scanner] Retry pass: re-running ${firstPassFailures.length} failed module(s) at the end of the step`);
    await logScanEvent(
      ctx.scanId, 'ai-research', 'info',
      `Retrying ${firstPassFailures.length} failed Sniper module(s) at the end of the step`,
      { modules: firstPassFailures.map(f => f.mod.name) },
      ctx.repoName, ctx.workspaceId,
    );

    for (const { index, rowId, mod, error: firstError } of firstPassFailures) {
      await markScanModuleRunning(rowId);
      const retryFailure = await attemptSniperModule(mod, index, rowId, true);
      if (retryFailure === null) {
        succeeded++;
        console.log(`[scanner] Sniper module "${mod.name}" succeeded on retry`);
        await logScanEvent(
          ctx.scanId, 'ai-research', 'info',
          `Sniper module "${mod.name}" succeeded on retry`,
          { module: mod.name }, ctx.repoName, ctx.workspaceId,
        );
      } else {
        moduleErrors.push({
          kind: 'module',
          name: mod.name,
          error: `failed after retry — attempt 1: ${firstError.split('\n')[0]}; attempt 2: ${retryFailure.split('\n')[0]}`,
          failedAfterRetry: true,
        });
        console.error(`[scanner] Sniper module "${mod.name}" failed AGAIN on retry: ${retryFailure.split('\n')[0]}`);
        // Error level — same severity class as a security tool failing after retry
        await logScanEvent(
          ctx.scanId,
          'ai-research',
          'error',
          `Sniper module "${mod.name}" failed after retry — its findings will be missing from this scan`,
          { module: mod.name, fileCount: mod.interesting.length, firstError: firstError.split('\n')[0], retryError: retryFailure.split('\n')[0] },
          ctx.repoName,
          ctx.workspaceId,
        );
      }
    }
  }

  // If every module failed even after retries, abort — there are no partials
  // to merge and the scan should not silently produce zero AI findings.
  if (succeeded === 0 && modules.length > 0) {
    throw new Error(
      `All ${modules.length} Sniper modules failed even after retries; AI research has no output. Last failures: ${moduleErrors.slice(-3).map(e => e.name).join(', ')}`,
    );
  }
  if (moduleErrors.length > 0) {
    console.warn(`[scanner] ${moduleErrors.length}/${modules.length} Sniper modules failed after retry; proceeding to merge with ${succeeded} successful partials`);
  }

  // Stage 6: Merge — runs even if some modules failed, surfacing what we have
  const findingsCount = await mergePartialsToSarif(ctx);

  const summary = summarizeMetrics(metrics, counts, modules.length);
  console.log(`[scanner] Pipeline complete: ${findingsCount} findings`);
  console.log(summary);

  await addScanFile({ scanId: ctx.scanId, fileName: 'ai-research.log', fileType: 'log-ai-research', content: summary });

  return aggregateOutput(metrics, startTime, moduleErrors);
}

function aggregateOutput(metrics: AgentMetric[], startTime: number, moduleErrors: ScanStepError[] = []): AiResearchOutput {
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;
  let primaryModel = '';

  for (const m of metrics) {
    totalCost += m.costUSD;
    totalInput += m.inputTokens;
    totalOutput += m.outputTokens;
    totalCacheRead += m.cacheReadInputTokens;
    totalCacheCreate += m.cacheCreationInputTokens;
    if (!primaryModel || m.agent.startsWith('sniper:')) primaryModel = m.model;
  }

  return {
    scanCompleted: true,
    skipped: false,
    durationMs: Date.now() - startTime,
    cost: totalCost,
    ...(moduleErrors.length > 0 ? { moduleErrors } : {}),
    aiUsage: {
      model: primaryModel,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadInputTokens: totalCacheRead,
      cacheCreationInputTokens: totalCacheCreate,
      costUSD: totalCost,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Public step
// ══════════════════════════════════════════════════════════════════════════════

export async function runAiResearchStep({ ctx, prev }: StepInput): Promise<AiResearchOutput> {
  if (!ctx.aiScanningEnabled) {
    console.log(`[ai-research] AI scanning disabled for workspace ${ctx.workspaceId}, skipping`);
    await logScanEvent(
      ctx.scanId, 'ai-research', 'warning',
      'AI Research skipped: AI scanning is disabled in workspace settings',
      {}, ctx.repoName, ctx.workspaceId,
    );
    return { scanCompleted: false, skipped: true, skipReason: 'ai-scanning-disabled', durationMs: 0 };
  }
  if (!prev.aiAvailable) {
    // SCREAM: the analysis step failed (aiAvailable=false). Previously this
    // skipped silently and the UI just showed "0s" with no explanation.
    console.warn(`[ai-research] Skipping for ${ctx.repoName} — analysis step did not succeed (aiAvailable=false)`);
    await logScanEvent(
      ctx.scanId, 'ai-research', 'error',
      'AI Research skipped: the analysis step failed, so there is no repository profile/metadata to scan. See the analysis step error above.',
      {}, ctx.repoName, ctx.workspaceId,
    );
    return { scanCompleted: false, skipped: true, skipReason: 'analysis-failed', durationMs: 0 };
  }

  // FAIL LOUD: the Sniper/scanner agents read their strategy from the scan context
  // written by the analyzer. If it's gone (analyzer regression, wiped volume on
  // resume), scanning would proceed blind — abort with a visible event instead.
  if (!(await checkRemoteFileExists(ctx.scanContextPath, ctx.cancelSignal))) {
    const errMsg = `Scan context missing at ${ctx.scanContextPath} — cannot scan without the analyzer's strategy input. Failing instead of scanning blind.`;
    await logScanEvent(ctx.scanId, 'ai-research', 'error', errMsg, {}, ctx.repoName, ctx.workspaceId);
    throw new Error(errMsg);
  }

  const start = Date.now();
  console.log(`[scanner] Starting AI research (linguist-based pipeline)`);

  try {
    return await runPipeline(ctx, start);
  } catch (err) {
    if (err instanceof SSHTimeoutError && err.stdout) {
      await addScanFile({ scanId: ctx.scanId, fileName: 'ai-research.log', fileType: 'log-ai-research', content: err.stdout }).catch(() => {});
    }
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Legacy export (single-pass scanner for tests / direct callers)
// ══════════════════════════════════════════════════════════════════════════════

export async function runScanner(ctx: PipelineContext): Promise<{ cost?: number; durationMs?: number; log: string; aiUsage?: AiUsage }> {
  const langLine = getLanguageInstruction(ctx.reportLanguage);
  const scanTarget = ctx.commitHash
    ? `Scan files changed in commit ${ctx.commitHash} in the repository at ${ctx.repoPath}`
    : `Scan the repository at ${ctx.repoPath}`;

  const prompt = [
    langLine,
    `${scanTarget} for security vulnerabilities.`,
    '',
    `Read the scan context first: ${ctx.scanContextPath}`,
    `Write SARIF output to: ${ctx.resultsDir}/code-analysis.sarif`,
    '',
    `Rules:`,
    `- Read the scan context BEFORE scanning — it has architecture, trust boundaries, and scan strategy`,
    `- Be aggressive — flag anything suspicious, use confidence levels`,
    `- ALWAYS write the SARIF file, even if zero vulnerabilities found`,
  ].filter(Boolean).join('\n');

  const modelId = resolveModelFlag(ctx.aiModelScanner, 'opus');
  const claudeArgs = `-p --model ${modelId} --verbose --append-system-prompt-file /prompts/scanner.md --output-format stream-json --dangerously-skip-permissions`;

  const { stdout, parsed } = await runClaudeWithTrace({
    scanId: ctx.scanId,
    wave: 'scanner',
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
    throw new Error(`Scanner failed: ${msg}`);
  }

  return {
    cost: parsed.total_cost_usd as number | undefined,
    durationMs: parsed.duration_ms as number | undefined,
    log: stdout,
    aiUsage: extractAiUsage(parsed),
  };
}
