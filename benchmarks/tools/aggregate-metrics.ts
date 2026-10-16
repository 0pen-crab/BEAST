#!/usr/bin/env tsx
/**
 * Reusable benchmark token / cost aggregator.
 *
 * Reads stream-json log files persisted in scan_files (file_type LIKE 'log-%')
 * and computes per-scan and per-agent metrics: tokens, cost, duration, num_turns.
 *
 * The orchestrator stores every Claude CLI invocation's raw stdout as a scan_file
 * with file_type = 'log-<agent>' (analysis / triage / ai-research / scanner-<module>
 * / sniper-fail / etc.). Each line of the file is a stream-json event; the LAST
 * event of type 'result' carries the final aggregate usage block:
 *   { total_cost_usd, duration_ms, num_turns, usage{...}, modelUsage{...} }
 *
 * Usage:
 *   npx tsx aggregate-metrics.ts --scans=<id>,<id>,...
 *   npx tsx aggregate-metrics.ts --repos=151,152,153 --since=2026-05-12
 *   npx tsx aggregate-metrics.ts --workspace=16 --since=2026-05-12T00:00:00Z
 *
 * Output:
 *   --out-json=<path>       Aggregated metrics as JSON (default: stdout)
 *   --out-md=<path>         Human-readable markdown report (default: none)
 *
 * Connection:
 *   DATABASE_URL env var (default: postgresql://beast:beast_dev_password@localhost:5432/beast)
 */

import postgres from 'postgres';
import { writeFileSync } from 'node:fs';

interface Args {
  scans?: string[];
  repos?: number[];
  workspace?: number;
  since?: string;
  until?: string;
  outJson?: string;
  outMd?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--scans=')) out.scans = a.slice(8).split(',').filter(Boolean);
    else if (a.startsWith('--repos=')) out.repos = a.slice(8).split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
    else if (a.startsWith('--workspace=')) out.workspace = Number(a.slice(12));
    else if (a.startsWith('--since=')) out.since = a.slice(8);
    else if (a.startsWith('--until=')) out.until = a.slice(8);
    else if (a.startsWith('--out-json=')) out.outJson = a.slice(11);
    else if (a.startsWith('--out-md=')) out.outMd = a.slice(9);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage:
  npx tsx aggregate-metrics.ts --scans=<id>,<id>,...
  npx tsx aggregate-metrics.ts --repos=151,152,153 --since=2026-05-12
  npx tsx aggregate-metrics.ts --workspace=16 --since=2026-05-12
Flags:
  --out-json=<path>     Write JSON to file
  --out-md=<path>       Write markdown report to file
`);
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

interface ResultEvent {
  type?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  is_error?: boolean;
  api_error_status?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUSD?: number;
  }>;
}

interface AgentMetric {
  agent: string;
  fileType: string;
  primaryModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalContextTokens: number;
  costUSD: number;
  durationMs: number;
  numTurns: number;
  isError: boolean;
  models: string[];
}

interface ScanReport {
  scanId: string;
  repoName: string;
  repoId: number | null;
  workspaceId: number | null;
  scanType: string;
  status: string;
  scanStartedAt: string | null;
  scanCompletedAt: string | null;
  scanDurationMs: number | null;
  scanDepth: number | null;
  agents: AgentMetric[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    contextTokens: number;
    costUSD: number;
    durationMs: number;
    numTurns: number;
    agentInvocations: number;
    errors: number;
  };
}

/**
 * Map a scan_files.file_type to a friendly agent name.
 * Examples:
 *   log-analysis           -> analyzer
 *   log-triage             -> triage
 *   log-ai-research        -> ai-research
 *   log-sniper-fail        -> sniper-fail
 *   log-scanner-auth       -> scanner:auth (Sniper module)
 *   log-scanner            -> scanner
 */
function agentNameFromFileType(fileType: string): string {
  const stripped = fileType.replace(/^log-/, '');
  switch (stripped) {
    case 'analysis':
      return 'analyzer';
    case 'triage':
      return 'triage';
    case 'ai-research':
      return 'ai-research';
    case 'sniper-fail':
      return 'sniper-fail';
    case 'scanner':
      return 'scanner';
  }
  if (stripped.startsWith('scanner-')) {
    return `scanner:${stripped.slice('scanner-'.length)}`;
  }
  return stripped;
}

function findResultEvent(content: string): ResultEvent | null {
  if (!content) return null;
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as ResultEvent;
      if (parsed.type === 'result') return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Parse the formatted multi-agent summary that the ai-research step writes
 * (the same format produced by formatAgentMetric in ssh.ts). One scan_files
 * row can describe N Claude invocations (one per Sniper / Scout module).
 *
 * Example line:
 *   agent=scout-unclear:0 model=claude-sonnet-4-6 input=667 cacheRead=67169 cacheCreate=8467
 *     output=1067 totalContext=10.2K limit=200K util=5.1% cost=$0.0685 duration=19.6s
 */
function parseFormattedMetricLines(content: string): AgentMetric[] {
  if (!content) return [];
  const out: AgentMetric[] = [];
  const re = /agent=(\S+)\s+model=(\S+)\s+input=(\d+)\s+cacheRead=(\d+)\s+cacheCreate=(\d+)\s+output=(\d+)\s+totalContext=([\d.]+)K\s+limit=([\d.]+)K\s+util=([\d.]+)%\s+cost=\$([\d.]+)\s+duration=([\d.]+)s/;
  for (const rawLine of content.split('\n')) {
    const m = re.exec(rawLine);
    if (!m) continue;
    const [, agent, model, inp, cr, cc, outp, ctxK, , , cost, durS] = m;
    const inputTokens = Number(inp);
    const cacheReadInputTokens = Number(cr);
    const cacheCreationInputTokens = Number(cc);
    const outputTokens = Number(outp);
    const totalContextTokens = Math.round(Number(ctxK) * 1000);
    const costUSD = Number(cost);
    const durationMs = Math.round(Number(durS) * 1000);
    out.push({
      agent,
      fileType: 'log-ai-research',
      primaryModel: model,
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      totalContextTokens,
      costUSD,
      durationMs,
      numTurns: 0,
      isError: false,
      models: [model],
    });
  }
  return out;
}

function buildAgentMetric(fileType: string, evt: ResultEvent): AgentMetric {
  const modelUsage = evt.modelUsage ?? {};
  const modelEntries = Object.entries(modelUsage);

  let inputTokens = 0,
    outputTokens = 0,
    cacheRead = 0,
    cacheCreate = 0,
    costUSD = 0;
  let primary = '';
  let primaryCost = -1;
  for (const [model, u] of modelEntries) {
    inputTokens += u.inputTokens ?? 0;
    outputTokens += u.outputTokens ?? 0;
    cacheRead += u.cacheReadInputTokens ?? 0;
    cacheCreate += u.cacheCreationInputTokens ?? 0;
    const c = u.costUSD ?? 0;
    costUSD += c;
    if (c > primaryCost) {
      primary = model;
      primaryCost = c;
    }
  }

  // Fallback to top-level usage / total_cost_usd if modelUsage is missing.
  if (modelEntries.length === 0) {
    inputTokens = evt.usage?.input_tokens ?? 0;
    outputTokens = evt.usage?.output_tokens ?? 0;
    cacheRead = evt.usage?.cache_read_input_tokens ?? 0;
    cacheCreate = evt.usage?.cache_creation_input_tokens ?? 0;
    costUSD = evt.total_cost_usd ?? 0;
    primary = 'unknown';
  } else if (typeof evt.total_cost_usd === 'number') {
    // The final result emits an authoritative cost; prefer it over the sum
    // when both are present (modelUsage may slightly differ in some SDK versions).
    costUSD = evt.total_cost_usd;
  }

  const totalContextTokens = inputTokens + outputTokens + cacheCreate;

  return {
    agent: agentNameFromFileType(fileType),
    fileType,
    primaryModel: primary,
    inputTokens,
    outputTokens,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreate,
    totalContextTokens,
    costUSD,
    durationMs: evt.duration_ms ?? 0,
    numTurns: evt.num_turns ?? 0,
    isError: evt.is_error === true || !!evt.api_error_status,
    models: modelEntries.map(([m]) => m),
  };
}

async function resolveScanIds(sql: postgres.Sql, args: Args): Promise<string[]> {
  if (args.scans && args.scans.length) return args.scans;

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (args.repos && args.repos.length) {
    conditions.push(`repository_id = ANY($${params.length + 1}::int[])`);
    params.push(args.repos as unknown as string); // sql.array would be cleaner; postgres-js handles array via template
  }
  if (args.workspace) {
    conditions.push(`workspace_id = $${params.length + 1}`);
    params.push(args.workspace);
  }
  if (args.since) {
    conditions.push(`created_at >= $${params.length + 1}`);
    params.push(args.since);
  }
  if (args.until) {
    conditions.push(`created_at < $${params.length + 1}`);
    params.push(args.until);
  }
  if (!conditions.length) {
    throw new Error('Provide --scans=..., or at least one of --repos / --workspace / --since.');
  }

  // Use template strings via postgres-js
  let query = sql.unsafe(
    `SELECT id::text AS id FROM scans WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`,
    params,
  );
  const rows = (await query) as { id: string }[];
  return rows.map((r) => r.id);
}

async function loadScan(sql: postgres.Sql, scanId: string): Promise<ScanReport | null> {
  const scanRows = await sql<
    {
      id: string;
      repo_name: string | null;
      repository_id: number | null;
      workspace_id: number | null;
      scan_type: string;
      status: string;
      started_at: Date | null;
      completed_at: Date | null;
      duration_ms: number | null;
      scan_depth: number | null;
    }[]
  >`
    SELECT s.id::text AS id,
           s.repo_name,
           s.repository_id,
           s.workspace_id,
           s.scan_type,
           s.status,
           s.started_at,
           s.completed_at,
           s.duration_ms,
           w.scan_depth
      FROM scans s
      LEFT JOIN workspaces w ON w.id = s.workspace_id
     WHERE s.id = ${scanId}
  `;
  if (!scanRows.length) return null;
  const s = scanRows[0];

  const fileRows = await sql<
    { file_type: string; content: string }[]
  >`
    SELECT file_type, content
      FROM scan_files
     WHERE scan_id = ${scanId}
       AND file_type LIKE 'log-%'
     ORDER BY file_type ASC
  `;

  const agents: AgentMetric[] = [];
  for (const f of fileRows) {
    const evt = findResultEvent(f.content);
    if (evt) {
      agents.push(buildAgentMetric(f.file_type, evt));
      continue;
    }
    // Fallback: the file is a human-readable summary written by the ai-research
    // step. It contains one or more `agent=... cost=$X ...` lines.
    const fallback = parseFormattedMetricLines(f.content);
    for (const a of fallback) agents.push({ ...a, fileType: f.file_type });
  }

  const totals = agents.reduce(
    (acc, a) => {
      acc.inputTokens += a.inputTokens;
      acc.outputTokens += a.outputTokens;
      acc.cacheReadInputTokens += a.cacheReadInputTokens;
      acc.cacheCreationInputTokens += a.cacheCreationInputTokens;
      acc.contextTokens += a.totalContextTokens;
      acc.costUSD += a.costUSD;
      acc.durationMs += a.durationMs;
      acc.numTurns += a.numTurns;
      acc.agentInvocations += 1;
      if (a.isError) acc.errors += 1;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      contextTokens: 0,
      costUSD: 0,
      durationMs: 0,
      numTurns: 0,
      agentInvocations: 0,
      errors: 0,
    },
  );

  return {
    scanId: s.id,
    repoName: s.repo_name ?? 'unknown',
    repoId: s.repository_id,
    workspaceId: s.workspace_id,
    scanType: s.scan_type,
    status: s.status,
    scanStartedAt: s.started_at ? s.started_at.toISOString() : null,
    scanCompletedAt: s.completed_at ? s.completed_at.toISOString() : null,
    scanDurationMs: s.duration_ms,
    scanDepth: s.scan_depth,
    agents,
    totals,
  };
}

function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function formatMinutes(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const m = ms / 60_000;
  if (m >= 60) return `${(m / 60).toFixed(2)}h`;
  if (m >= 1) return `${m.toFixed(1)}min`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function cacheHitRatio(s: ScanReport): number {
  const denom = s.totals.cacheReadInputTokens + s.totals.cacheCreationInputTokens;
  return denom > 0 ? s.totals.cacheReadInputTokens / denom : 0;
}

function renderMarkdown(reports: ScanReport[]): string {
  const lines: string[] = [];
  lines.push('# Benchmark — Token & Cost Aggregation');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Scans: ${reports.length}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Repo | Status | Depth | Wall (scan.duration_ms) | Σ agent duration | Cost | Input | Output | Cache R | Cache C | Cache hit |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    lines.push(
      `| ${r.repoName} | ${r.status} | ${r.scanDepth ?? '—'} | ${formatMinutes(r.scanDurationMs)} | ${formatMinutes(r.totals.durationMs)} | ${formatCost(r.totals.costUSD)} | ${formatTokens(r.totals.inputTokens)} | ${formatTokens(r.totals.outputTokens)} | ${formatTokens(r.totals.cacheReadInputTokens)} | ${formatTokens(r.totals.cacheCreationInputTokens)} | ${(cacheHitRatio(r) * 100).toFixed(1)}% |`,
    );
  }
  lines.push('');

  // Aggregate totals across all scans
  const grand = reports.reduce(
    (acc, r) => {
      acc.input += r.totals.inputTokens;
      acc.output += r.totals.outputTokens;
      acc.cacheR += r.totals.cacheReadInputTokens;
      acc.cacheC += r.totals.cacheCreationInputTokens;
      acc.cost += r.totals.costUSD;
      acc.dur += r.totals.durationMs;
      acc.agents += r.totals.agentInvocations;
      acc.errors += r.totals.errors;
      return acc;
    },
    { input: 0, output: 0, cacheR: 0, cacheC: 0, cost: 0, dur: 0, agents: 0, errors: 0 },
  );

  lines.push('## Grand totals');
  lines.push('');
  lines.push(`- Total cost: **${formatCost(grand.cost)}**`);
  lines.push(`- Total input tokens: **${formatTokens(grand.input)}**`);
  lines.push(`- Total output tokens: **${formatTokens(grand.output)}**`);
  lines.push(`- Total cache read: **${formatTokens(grand.cacheR)}**`);
  lines.push(`- Total cache create: **${formatTokens(grand.cacheC)}**`);
  lines.push(`- Agent invocations: **${grand.agents}**`);
  lines.push(`- Agent errors: **${grand.errors}**`);
  lines.push(`- Σ agent duration: **${formatMinutes(grand.dur)}**`);
  lines.push('');

  lines.push('## Per-scan agent breakdown');
  lines.push('');
  for (const r of reports) {
    lines.push(`### ${r.repoName} (${r.scanId.slice(0, 8)})`);
    lines.push('');
    lines.push(`- scan_type: ${r.scanType}, status: ${r.status}, depth: ${r.scanDepth ?? '—'}`);
    lines.push(`- wall: ${formatMinutes(r.scanDurationMs)}, agents: ${r.agents.length}, errors: ${r.totals.errors}`);
    lines.push('');
    lines.push('| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const a of r.agents) {
      lines.push(
        `| ${a.agent}${a.isError ? ' ⚠️' : ''} | ${a.primaryModel} | ${a.numTurns} | ${formatMinutes(a.durationMs)} | ${formatCost(a.costUSD)} | ${formatTokens(a.inputTokens)} | ${formatTokens(a.outputTokens)} | ${formatTokens(a.cacheReadInputTokens)} | ${formatTokens(a.cacheCreationInputTokens)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const url = process.env.DATABASE_URL || 'postgresql://beast:beast_dev_password@localhost:5432/beast';
  const sql = postgres(url, { max: 4, onnotice: () => {} });

  try {
    const scanIds = await resolveScanIds(sql, args);
    if (!scanIds.length) {
      console.error('No scans matched the given filters.');
      process.exit(1);
    }

    const reports: ScanReport[] = [];
    for (const id of scanIds) {
      const rpt = await loadScan(sql, id);
      if (!rpt) {
        console.error(`scan not found: ${id}`);
        continue;
      }
      reports.push(rpt);
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      scans: reports,
    };

    const json = JSON.stringify(payload, null, 2);
    if (args.outJson) {
      writeFileSync(args.outJson, json);
      console.error(`Wrote JSON: ${args.outJson}`);
    } else {
      console.log(json);
    }

    if (args.outMd) {
      writeFileSync(args.outMd, renderMarkdown(reports));
      console.error(`Wrote markdown: ${args.outMd}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
