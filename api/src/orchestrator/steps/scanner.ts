import { sshExec, sshWriteFile, getClaudeRunnerConfig, parseStreamJsonResult, extractAiUsage, buildAgentMetric, formatAgentMetric, SSHTimeoutError } from '../ssh.ts';
import type { AgentMetric } from '../ssh.ts';
import { checkRateLimitAndPause, ScanPausedError } from '../rate-limit.ts';
import type { PipelineContext, StepInput, AiResearchOutput, AiUsage } from '../pipeline-types.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS } from '../pipeline-types.ts';
import { getLanguageInstruction } from '../prompt-languages.ts';
import { resolveModelFlag } from '../ai-models.ts';
import { addScanFile } from '../entities.ts';
import { logScanEvent } from '../pipeline.ts';
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
  userPrompt: string,
  systemPromptFile: string,
  modelKey: string,
  fallback: 'opus' | 'sonnet' | 'haiku',
  timeoutMs: number,
  cancelSignal?: AbortSignal,
): Promise<ClaudeInvocation> {
  const modelId = resolveModelFlag(modelKey, fallback);
  const command = `echo ${JSON.stringify(userPrompt)} | claude -p --model ${modelId} --verbose --append-system-prompt-file ${systemPromptFile} --output-format stream-json --dangerously-skip-permissions`;

  const started = Date.now();
  const result = await sshExec(getClaudeRunnerConfig(), command, {
    inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: timeoutMs,
    signal: cancelSignal,
  });
  const durationMs = Date.now() - started;

  const { result: parsed, log } = parseStreamJsonResult(result.stdout);

  if (parsed.is_error) {
    const msg = String(parsed.result ?? 'unknown error');
    if (msg.includes('Not logged in')) {
      throw new ClaudeInvocationError('Claude Code is not authenticated on claude-runner. Run: make claude-login', result.stdout);
    }
    checkRateLimitAndPause(result.stdout, msg);
    throw new ClaudeInvocationError(`Claude failed: ${msg}`, result.stdout);
  }

  return { parsed, log, usage: extractAiUsage(parsed), durationMs };
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

function partialOutputPath(ctx: PipelineContext, moduleName: string): string {
  return `${ctx.agentDir}/partial-${safeName(moduleName)}.json`;
}

// ── JSON-from-SSH helper ─────────────────────────────────────────────────────

async function readJsonFromRemote<T>(path: string): Promise<T | null> {
  try {
    const res = await sshExec(getClaudeRunnerConfig(), `cat ${JSON.stringify(path)} 2>/dev/null`);
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

  const manifest = batchFiles.map(f => ({
    path: f.path,
    size_bytes: f.size_bytes,
    line_count: f.line_count,
    ext: f.ext,
    avg_line_length: f.avg_line_length,
    is_binary: f.is_binary,
  }));
  await sshWriteFile(getClaudeRunnerConfig(), batchPath, JSON.stringify(manifest));

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

  const inv = await runClaudeWithPrompt(userPrompt, '/prompts/scanner-scout-unclear.md', 'sonnet', 'sonnet', AI_MAX_TIMEOUT_MS, ctx.cancelSignal);
  if (inv.usage) {
    const m = buildAgentMetric(`scout-unclear:${batchIdx}`, inv.usage, inv.durationMs);
    metrics.push(m);
    console.log(`[scanner] ${formatAgentMetric(m, ctx.scanId)}`);
  }

  const out = await readJsonFromRemote<ScoutResult>(outPath);
  if (!out || !Array.isArray(out.interesting) || !Array.isArray(out.trash)) {
    console.error(`[scanner] Scout unclear batch ${batchIdx} produced no valid output — treating all as INTERESTING (fail-safe)`);
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
): Promise<void> {
  const outPath = partialOutputPath(ctx, module.name);
  console.log(`[scanner] Sniper ${index + 1}/${total} "${module.name}" (${module.interesting.length} INTERESTING, ${module.docs.length} DOCS)`);

  if (module.interesting.length === 0) {
    await sshWriteFile(getClaudeRunnerConfig(), outPath, '[]');
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
    `PROFILE_PATH: ${ctx.profilePath}`,
    `PARTIAL_OUTPUT_PATH: ${outPath}`,
    '',
    `Files to scan (absolute scope — do not scan files outside this list):`,
    interestingLines + docsLines,
    '',
    `Follow system prompt. Read each INTERESTING file fully, find vulnerabilities, write JSON array to PARTIAL_OUTPUT_PATH.`,
  ].filter(Boolean).join('\n');

  const inv = await runClaudeWithPrompt(userPrompt, '/prompts/scanner-sniper.md', 'opus', 'opus', AI_MAX_TIMEOUT_MS, ctx.cancelSignal);
  if (inv.usage) {
    const m = buildAgentMetric(`sniper:${safeName(module.name)}`, inv.usage, inv.durationMs);
    metrics.push(m);
    console.log(`[scanner] ${formatAgentMetric(m, ctx.scanId)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Stage 7: Merge partials → SARIF
// ══════════════════════════════════════════════════════════════════════════════

async function mergePartialsToSarif(ctx: PipelineContext): Promise<number> {
  const lsResult = await sshExec(getClaudeRunnerConfig(), `ls ${ctx.agentDir}/partial-*.json 2>/dev/null || true`);
  const files = lsResult.stdout.trim().split('\n').filter(Boolean);

  const allFindings: Array<Record<string, unknown>> = [];
  for (const filePath of files) {
    const parsed = await readJsonFromRemote<unknown[]>(filePath);
    if (Array.isArray(parsed)) allFindings.push(...(parsed as Record<string, unknown>[]));
  }

  console.log(`[scanner] Merged ${allFindings.length} findings from ${files.length} partial files`);

  const sarif = buildSarif(allFindings);
  await sshWriteFile(getClaudeRunnerConfig(), `${ctx.resultsDir}/code-analysis.sarif`, JSON.stringify(sarif, null, 2));
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
    bucket.peakUtil = Math.max(bucket.peakUtil, m.utilizationPct);
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
  const { files: classified, counts } = await preClassifyAll(mirror.metadataPath, classifiedPath);
  console.log(`[scanner] Pre-classify counts: ${JSON.stringify(counts)}`);

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
  let failed = 0;
  const failedModules: string[] = [];

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    let row = modulesByIndex.get(i);
    if (!row) {
      row = await ensureScanModule({
        scanId: ctx.scanId,
        moduleIndex: i,
        moduleName: mod.name,
        fileCount: mod.interesting.length,
        outputPath: partialOutputPath(ctx, mod.name),
      });
    }

    if (row.status === 'completed') {
      console.log(`[scanner] Sniper ${i + 1}/${modules.length} "${mod.name}" — skipped (already completed)`);
      succeeded++;
      continue;
    }

    await markScanModuleRunning(row.id);
    try {
      await runSniperForModule(ctx, mod, i, modules.length, metrics);
      await markScanModuleCompleted(row.id);
      succeeded++;
    } catch (err) {
      // ScanPausedError (rate limit) is a clean, resumable interrupt — propagate
      // it so the worker can checkpoint and retry. Other errors are isolated to
      // this module: log them and keep going so the merge step can still run on
      // whatever partials succeeded.
      if (err instanceof ScanPausedError) {
        await markScanModulePending(row.id, err.message);
        throw err;
      }
      // Persist Claude's raw stdout for diagnosis. Without this we lose visibility
      // into WHY the Sniper failed (timeout, OOM, rate-limit-without-error-event, etc.).
      if (err instanceof ClaudeInvocationError) {
        await addScanFile({
          scanId: ctx.scanId,
          fileName: `sniper-${safeName(mod.name)}-fail.log`,
          fileType: 'log-sniper-fail',
          content: err.stdout,
        }).catch((e) => console.error(`[scanner] Failed to persist fail-log:`, e));
      }
      const msg = err instanceof Error ? err.message : String(err);
      const tail = err instanceof ClaudeInvocationError ? err.tail : '';
      const detail = tail ? `${msg}\n--- last 2KB of Claude stdout ---\n${tail}` : msg;
      await markScanModuleFailed(row.id, detail);
      failed++;
      failedModules.push(mod.name);
      console.error(`[scanner] Sniper module "${mod.name}" failed: ${msg}. Continuing with remaining modules.`);
      await logScanEvent(
        ctx.scanId,
        'ai-research',
        'warning',
        `Sniper module "${mod.name}" failed — its findings will be missing from this scan, but other modules continue`,
        { module: mod.name, fileCount: mod.interesting.length, error: msg },
        ctx.repoName,
        ctx.workspaceId,
      );
    }
  }

  // If every module failed, abort — there are no partials to merge and the
  // scan should not silently produce zero AI findings.
  if (succeeded === 0 && modules.length > 0) {
    throw new Error(
      `All ${modules.length} Sniper modules failed; AI research has no output. Last failures: ${failedModules.slice(-3).join(', ')}`,
    );
  }
  if (failed > 0) {
    console.warn(`[scanner] ${failed}/${modules.length} Sniper modules failed; proceeding to merge with ${succeeded} successful partials`);
  }

  // Stage 6: Merge — runs even if some modules failed, surfacing what we have
  const findingsCount = await mergePartialsToSarif(ctx);

  const summary = summarizeMetrics(metrics, counts, modules.length);
  console.log(`[scanner] Pipeline complete: ${findingsCount} findings`);
  console.log(summary);

  await addScanFile({ scanId: ctx.scanId, fileName: 'ai-research.log', fileType: 'log-ai-research', content: summary });

  return aggregateOutput(metrics, startTime);
}

function aggregateOutput(metrics: AgentMetric[], startTime: number): AiResearchOutput {
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
    return { scanCompleted: false, skipped: true, durationMs: 0 };
  }
  if (!prev.aiAvailable) {
    return { scanCompleted: false, skipped: true, durationMs: 0 };
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
    `Read the profile first: ${ctx.profilePath}`,
    `Write SARIF output to: ${ctx.resultsDir}/code-analysis.sarif`,
    '',
    `Rules:`,
    `- Read the profile BEFORE scanning — it has architecture, trust boundaries, and scan strategy`,
    `- Be aggressive — flag anything suspicious, use confidence levels`,
    `- ALWAYS write the SARIF file, even if zero vulnerabilities found`,
  ].filter(Boolean).join('\n');

  const modelId = resolveModelFlag(ctx.aiModelScanner, 'opus');
  const command = `echo ${JSON.stringify(prompt)} | claude -p --model ${modelId} --verbose --append-system-prompt-file /prompts/scanner.md --output-format stream-json --dangerously-skip-permissions`;

  const result = await sshExec(getClaudeRunnerConfig(), command, {
    inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: AI_MAX_TIMEOUT_MS,
    signal: ctx.cancelSignal,
  });

  const { result: parsed, log } = parseStreamJsonResult(result.stdout);

  if (parsed.is_error) {
    const msg = String(parsed.result ?? 'unknown error');
    if (msg.includes('Not logged in')) {
      throw new Error('Claude Code is not authenticated on claude-runner. Run: make claude-login');
    }
    checkRateLimitAndPause(result.stdout, msg);
    throw new Error(`Scanner failed: ${msg}`);
  }

  return {
    cost: parsed.total_cost_usd as number | undefined,
    durationMs: parsed.duration_ms as number | undefined,
    log,
    aiUsage: extractAiUsage(parsed),
  };
}
