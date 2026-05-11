#!/usr/bin/env tsx
/**
 * Sniper module-size benchmark harness.
 *
 * Reuses an existing scan's mirror + classified metadata + Scout UNCLEAR results,
 * then RE-RUNS only the partitioner + Sniper stages with a custom module size.
 * This lets us sweep the `target` / `max` module-size parameter cheaply without
 * re-paying for mirror, analyzer, or Scout stages.
 *
 * Usage:
 *   tsx scripts/bench-sniper.ts --scan-id <uuid> --target <N> --max <N> [--parallel <N>]
 *
 * Output:
 *   bench-out/<scan-id>/target-<N>/
 *     partial-<module>.json     (findings per module)
 *     metrics.json              (per-module cost, duration, util)
 *     summary.json              (aggregate — total cost, findings, density, $/finding)
 *
 * Example:
 *   tsx scripts/bench-sniper.ts \
 *     --scan-id 37586fbb-f566-452d-a424-1e561ec424cb \
 *     --target 500 --max 650
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  sshExec,
  sshWriteFile,
  getClaudeRunnerConfig,
  parseStreamJsonResult,
  extractAiUsage,
  buildAgentMetric,
  formatAgentMetric,
  type AgentMetric,
} from '../src/orchestrator/ssh.ts';
import { partition, type PartitionModule } from '../src/orchestrator/steps/partitioner.ts';
import type { ClassifiedFile } from '../src/orchestrator/steps/pre-classifier.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS } from '../src/orchestrator/pipeline-types.ts';

interface Args {
  scanId: string;
  target: number;
  max: number;
  parallel: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const scanId = get('--scan-id');
  const target = Number(get('--target'));
  const max = Number(get('--max'));
  const parallel = Number(get('--parallel') ?? '1');
  if (!scanId || !target || !max) {
    console.error('Usage: tsx bench-sniper.ts --scan-id <uuid> --target <N> --max <N> [--parallel <N>]');
    process.exit(1);
  }
  return { scanId, target, max, parallel };
}

/** Locate the scan's agent_files/ directory on claude-runner by scanning /workspace. */
async function findAgentFilesPath(scanId: string): Promise<{ repoPath: string; agentDir: string; resultsDir: string }> {
  // Scans live under /workspace/<repoName>/<scanId>/agent_files
  const lsRes = await sshExec(
    getClaudeRunnerConfig(),
    `ls -d /workspace/*/${scanId}/agent_files 2>/dev/null | head -1`,
  );
  const agentDir = lsRes.stdout.trim();
  if (!agentDir) throw new Error(`No agent_files dir found for scan ${scanId} on claude-runner`);
  const workDir = path.dirname(agentDir);
  const resultsDir = `${workDir}/tools_results`;
  const repoName = path.basename(path.dirname(workDir));
  const repoPath = `/workspace/${repoName}/repo`;
  return { repoPath, agentDir, resultsDir };
}

/** Read classified-metadata.jsonl from the scan's agent_files/. */
async function loadClassified(agentDir: string): Promise<ClassifiedFile[]> {
  const res = await sshExec(getClaudeRunnerConfig(), `cat ${JSON.stringify(`${agentDir}/classified-metadata.jsonl`)}`);
  const lines = res.stdout.split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l) as ClassifiedFile);
}

/** Load Scout UNCLEAR results and apply them to the classified list. */
async function applyScoutDecisions(agentDir: string, classified: ClassifiedFile[]): Promise<ClassifiedFile[]> {
  // Discover scout-unclear-result-*.json files
  const ls = await sshExec(
    getClaudeRunnerConfig(),
    `ls ${JSON.stringify(agentDir)}/scout-unclear-result-*.json 2>/dev/null || true`,
  );
  const files = ls.stdout.trim().split('\n').filter(Boolean);
  const promoted = new Set<string>();
  for (const f of files) {
    const r = await sshExec(getClaudeRunnerConfig(), `cat ${JSON.stringify(f)}`);
    try {
      const obj = JSON.parse(r.stdout);
      for (const p of obj.interesting ?? []) promoted.add(p);
    } catch {
      // skip malformed
    }
  }
  return classified.map((f) => {
    if (f.bucket === 'UNCLEAR') {
      return { ...f, bucket: promoted.has(f.path) ? 'INTERESTING' : 'TRASH' };
    }
    return f;
  });
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80).toLowerCase();
}

async function runSniperOnModule(
  benchDir: string,
  repoPath: string,
  profilePath: string,
  module: PartitionModule,
  index: number,
  total: number,
): Promise<AgentMetric | null> {
  const outPath = `${benchDir}/partial-${safeName(module.name)}.json`;

  if (module.interesting.length === 0) {
    await sshWriteFile(getClaudeRunnerConfig(), outPath, '[]');
    return null;
  }

  const interestingLines = module.interesting.map((p) => `- ${p}`).join('\n');
  const docsLines =
    module.docs.length > 0
      ? '\n\nDOCS (reference context — read on demand when uncertain about intent):\n' +
        module.docs.map((p) => `- ${p}`).join('\n')
      : '';

  const userPrompt = [
    `Deep vulnerability scan for module: ${module.name}`,
    '',
    `REPO_PATH: ${repoPath}`,
    `PROFILE_PATH: ${profilePath}`,
    `PARTIAL_OUTPUT_PATH: ${outPath}`,
    '',
    `Files to scan (absolute scope — do not scan files outside this list):`,
    interestingLines + docsLines,
    '',
    `Follow system prompt. Read each INTERESTING file fully, find vulnerabilities, write JSON array to PARTIAL_OUTPUT_PATH.`,
  ].join('\n');

  const command =
    `echo ${JSON.stringify(userPrompt)} | claude -p ` +
    `--model claude-opus-4-6[1m] --verbose ` +
    `--append-system-prompt-file /prompts/scanner-sniper.md ` +
    `--output-format stream-json --dangerously-skip-permissions`;

  console.log(`[bench] Sniper ${index + 1}/${total} "${module.name}" (${module.interesting.length} files, ${module.docs.length} docs)`);

  const started = Date.now();
  const res = await sshExec(getClaudeRunnerConfig(), command, {
    inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: AI_MAX_TIMEOUT_MS,
  });
  const durationMs = Date.now() - started;
  const { result: parsed } = parseStreamJsonResult(res.stdout);
  if (parsed.is_error) {
    console.error(`[bench] Sniper ${module.name} FAILED: ${parsed.result}`);
    return null;
  }
  const usage = extractAiUsage(parsed);
  if (!usage) return null;
  const metric = buildAgentMetric(`sniper:${safeName(module.name)}`, usage, durationMs);
  console.log(`[bench] ${formatAgentMetric(metric)}`);
  return metric;
}

async function runBatch<T>(items: T[], fn: (item: T, i: number) => Promise<unknown>, concurrency: number): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push((async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try {
          await fn(items[i], i);
        } catch (err) {
          console.error(`[bench] Module ${i} threw:`, err instanceof Error ? err.message : err);
        }
      }
    })());
  }
  await Promise.all(workers);
}

async function countFindingsInPartial(path: string): Promise<number> {
  try {
    const res = await sshExec(getClaudeRunnerConfig(), `cat ${JSON.stringify(path)} 2>/dev/null`);
    const content = res.stdout.trim();
    if (!content) return 0;
    const arr = JSON.parse(content);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[bench] scan=${args.scanId} target=${args.target} max=${args.max} parallel=${args.parallel}`);

  const { repoPath, agentDir } = await findAgentFilesPath(args.scanId);
  const profilePath = `${path.dirname(path.dirname(agentDir))}/repo-profile.md`.replace(/\/+/g, '/');
  console.log(`[bench] repoPath=${repoPath}`);
  console.log(`[bench] agentDir=${agentDir}`);
  console.log(`[bench] profilePath=${profilePath}`);

  const classified = await loadClassified(agentDir);
  console.log(`[bench] Loaded ${classified.length} classified files`);

  const finalFiles = await applyScoutDecisions(agentDir, classified);
  const interestingCount = finalFiles.filter((f) => f.bucket === 'INTERESTING').length;
  const docsCount = finalFiles.filter((f) => f.bucket === 'DOCS').length;
  console.log(`[bench] After scout: INTERESTING=${interestingCount} DOCS=${docsCount}`);

  const { modules, counts } = partition(finalFiles, {
    targetFilesPerModule: args.target,
    maxFilesPerModule: args.max,
    singleModuleThreshold: args.max, // match behavior: only single-module when repo fits max
  });
  console.log(`[bench] Partitioned into ${counts.modules} modules`);

  // Bench output directory — keep INSIDE agentDir (scanner-owned); workDir is root-owned
  const benchDir = `${agentDir}/bench-target-${args.target}`;
  await sshExec(getClaudeRunnerConfig(), `mkdir -p ${JSON.stringify(benchDir)}`);

  // Write partition snapshot
  const partitionSnapshot = modules.map((m) => ({
    name: m.name,
    interesting_count: m.interesting.length,
    docs_count: m.docs.length,
  }));
  await sshWriteFile(
    getClaudeRunnerConfig(),
    `${benchDir}/partition.json`,
    JSON.stringify(partitionSnapshot, null, 2),
  );

  // Resume: skip modules where partial-*.json already exists with findings
  const existingCheck = await sshExec(
    getClaudeRunnerConfig(),
    `ls ${JSON.stringify(benchDir)}/partial-*.json 2>/dev/null | xargs -I{} basename {} .json 2>/dev/null | sed 's/^partial-//' || true`,
  );
  const existingNames = new Set(existingCheck.stdout.trim().split('\n').filter(Boolean));
  const pending = modules.filter((m) => {
    const name = safeName(m.name);
    if (existingNames.has(name)) {
      console.log(`[bench] SKIP ${m.name} (partial exists)`);
      return false;
    }
    return true;
  });
  console.log(`[bench] ${pending.length}/${modules.length} modules need processing (${modules.length - pending.length} already complete)`);

  const metrics: AgentMetric[] = [];
  const started = Date.now();

  await runBatch(
    pending,
    async (mod, i) => {
      const m = await runSniperOnModule(benchDir, repoPath, profilePath, mod, i, pending.length);
      if (m) metrics.push(m);
    },
    args.parallel,
  );

  const totalDurationMs = Date.now() - started;

  // Collect findings counts per module
  const moduleFindings: Record<string, number> = {};
  let totalFindings = 0;
  for (const mod of modules) {
    const c = await countFindingsInPartial(`${benchDir}/partial-${safeName(mod.name)}.json`);
    moduleFindings[mod.name] = c;
    totalFindings += c;
  }

  const totalCost = metrics.reduce((sum, m) => sum + m.costUSD, 0);
  const peakUtil = metrics.reduce((max, m) => Math.max(max, m.utilizationPct), 0);
  const avgDuration = metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.durationMs, 0) / metrics.length : 0;

  const summary = {
    scan_id: args.scanId,
    target: args.target,
    max: args.max,
    parallel: args.parallel,
    total_files_interesting: interestingCount,
    total_files_docs: docsCount,
    module_count: modules.length,
    total_findings: totalFindings,
    total_cost_usd: Number(totalCost.toFixed(4)),
    findings_per_file: interestingCount > 0 ? Number((totalFindings / interestingCount).toFixed(4)) : 0,
    cost_per_finding: totalFindings > 0 ? Number((totalCost / totalFindings).toFixed(4)) : 0,
    peak_context_util_pct: Number(peakUtil.toFixed(1)),
    avg_duration_ms: Math.round(avgDuration),
    total_wallclock_ms: totalDurationMs,
    per_module: metrics.map((m) => ({
      agent: m.agent,
      model: m.model,
      total_context: m.totalContext,
      utilization_pct: Number(m.utilizationPct.toFixed(1)),
      cost_usd: Number(m.costUSD.toFixed(4)),
      duration_ms: m.durationMs,
      findings: moduleFindings[m.agent.replace('sniper:', '')] ?? 0,
    })),
  };

  await sshWriteFile(
    getClaudeRunnerConfig(),
    `${benchDir}/summary.json`,
    JSON.stringify(summary, null, 2),
  );

  // Pretty-print summary locally too
  const localBenchDir = path.resolve(`bench-out/${args.scanId}/target-${args.target}`);
  await fs.mkdir(localBenchDir, { recursive: true });
  await fs.writeFile(path.join(localBenchDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('');
  console.log('=== BENCH SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
