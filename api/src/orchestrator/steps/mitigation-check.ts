// Mitigation check — verified auto-closing of fixed findings.
//
// On repeat scans, findings fixed since the previous scan used to stay 'open'
// forever: the pipeline only ever upserted what the CURRENT scan detected and
// never looked at what it did NOT detect. This step closes that gap safely:
//
//   1. Candidates = the repo's existing OPEN findings that this scan did not
//      re-detect (no fingerprint match, no semantic same_as match), restricted
//      to tools that ACTUALLY ran successfully this scan — a tool that was
//      disabled/failed tells us nothing about its old findings.
//   2. An AI agent goes into the cloned repo and verifies EACH candidate in
//      the code. Only findings it confirms are gone become 'fixed'.
//   3. The verdicts travel through the step output (resume-safe) and are
//      applied by the final 'commit' step — this step writes NO repo data.
//
// A 'still_present' verdict means the agent found the vulnerability alive in
// the code even though the scanner missed it — that is a scanner regression
// and it screams as an error scan event.
//
// Gated by the SAME workspace toggle as triage (aiTriageEnabled): if the
// workspace trusts AI to triage findings, it trusts it to verify fixes.

import fs from 'node:fs/promises';
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { findings } from '../../db/schema.ts';
import { logScanEvent } from '../events.ts';
import { sshWriteFile, getClaudeRunnerConfig, extractAiUsage, SSHTimeoutError } from '../ssh.ts';
import { runClaudeWithTrace } from '../ai-trace.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS } from '../pipeline-types.ts';
import type {
  PipelineContext, StepInput, AiUsage, ScanStepError, ToolResult,
  PreparedFinding, TriageDecisionPlan, MitigationCheckOutput, MitigationDecisionPlan,
} from '../pipeline-types.ts';
import { getLanguageInstruction } from '../prompt-languages.ts';
import { resolveModelFlag } from '../ai-models.ts';
import { addScanFile } from '../entities.ts';
import { TOOL_MAP } from './import-results.ts';

/** Newest-first cap on candidates sent to the agent (prompt size guard). */
export const MITIGATION_CANDIDATE_LIMIT = 300;

const VALID_VERDICTS = new Set(['fixed', 'still_present', 'unverifiable']);

/** Existing open finding offered to the agent for in-code verification. */
export interface MitigationCandidate {
  id: number;
  title: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  tool: string;
  vulnIdFromTool: string | null;
  description: string | null;
}

// Thin wrapper: fills the step's identity fields from ctx.
async function logMitigationScanEvent(
  ctx: PipelineContext,
  level: 'info' | 'warning' | 'error',
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await logScanEvent(ctx.scanId, 'mitigation-check', level, message, details, ctx.repoName, ctx.workspaceId);
}

/**
 * Which findings.tool values had FULL coverage this scan. Only their old
 * findings may be closed — "not detected" by a tool that never ran (disabled,
 * failed, skipped) means nothing.
 *
 * - Deterministic tools: security-tools summary entries with status 'success'
 *   (summary keys are translated to findings.tool values via TOOL_MAP).
 * - AI ('beast'): ai-research completed AND no Sniper module stayed failed —
 *   partial module coverage must not close findings from unscanned modules.
 */
export function resolveRanTools(prev: Record<string, unknown>): string[] {
  const ran: string[] = [];

  const toolResults = (prev.toolResults ?? {}) as Record<string, ToolResult>;
  for (const [key, result] of Object.entries(toolResults)) {
    if (result?.status === 'success') ran.push(TOOL_MAP[key] ?? key);
  }

  const moduleErrors = (prev.moduleErrors ?? []) as ScanStepError[];
  if (prev.scanCompleted === true && moduleErrors.length === 0) {
    ran.push('beast');
  }

  return ran;
}

/**
 * DB ids of existing findings that THIS scan re-detected: fingerprint matches
 * from the import plan plus semantic same_as matches from triage decisions.
 * They are alive by definition — never mitigation candidates.
 */
export function collectMatchedFindingIds(
  preparedFindings: PreparedFinding[],
  decisions: TriageDecisionPlan[],
): Set<number> {
  const ids = new Set<number>();
  for (const f of preparedFindings) {
    if (f.matchedFindingId != null) ids.add(f.matchedFindingId);
  }
  for (const d of decisions) {
    if (d.same_as != null && Number.isInteger(d.same_as)) ids.add(d.same_as);
  }
  return ids;
}

/**
 * READ-ONLY: the repo's open findings eligible for verification. Unlike the
 * triage candidate fetch, a DB failure here PROPAGATES — this step is required
 * when the triage toggle is on, and silently skipping verification would leave
 * fixed findings stuck open with no signal.
 */
export async function fetchMitigationCandidates(
  ctx: PipelineContext,
  repositoryId: number | undefined,
  ranTools: string[],
  excludedIds: Set<number>,
): Promise<MitigationCandidate[]> {
  if (!repositoryId || ranTools.length === 0) return [];

  const conditions = [
    eq(findings.repositoryId, repositoryId),
    eq(findings.status, 'open'),
    inArray(findings.tool, ranTools),
  ];
  if (excludedIds.size > 0) {
    conditions.push(notInArray(findings.id, [...excludedIds]));
  }

  const rows = await db.select({
    id: findings.id,
    title: findings.title,
    severity: findings.severity,
    filePath: findings.filePath,
    line: findings.line,
    tool: findings.tool,
    vulnIdFromTool: findings.vulnIdFromTool,
    description: findings.description,
  })
    .from(findings)
    .where(and(...conditions))
    .orderBy(desc(findings.id))
    .limit(MITIGATION_CANDIDATE_LIMIT + 1); // +1 to detect truncation

  if (rows.length > MITIGATION_CANDIDATE_LIMIT) {
    const message = `Mitigation candidates truncated to the ${MITIGATION_CANDIDATE_LIMIT} newest open findings — older ones stay open and will be verified on the next scan`;
    console.warn(`[mitigation] ${message}`);
    await logMitigationScanEvent(ctx, 'warning', message, { limit: MITIGATION_CANDIDATE_LIMIT });
    return rows.slice(0, MITIGATION_CANDIDATE_LIMIT);
  }
  return rows;
}

/**
 * Build the base64 agent input: candidates keyed by their DATABASE ids, plus
 * a compact summary of what the current scan DID find — so the agent can
 * recognize a candidate that survived as a differently-fingerprinted new
 * finding (moved file, shifted line) and verdict it still_present.
 */
export function prepareMitigationInput(
  ctx: PipelineContext,
  candidates: MitigationCandidate[],
  preparedFindings: PreparedFinding[],
): string | null {
  if (candidates.length === 0) return null;

  const input = {
    repo_name: ctx.repoName,
    repo_path: ctx.repoPath,
    scan_context_path: ctx.scanContextPath,
    results_dir: ctx.resultsDir,
    candidates: candidates.map(c => ({
      id: c.id,
      title: c.title,
      severity: c.severity,
      file_path: c.filePath ?? '',
      line: c.line,
      tool: c.tool,
      vuln_id: c.vulnIdFromTool ?? '',
      description: (c.description ?? '').slice(0, 500),
    })),
    current_scan_findings: preparedFindings.map(f => ({
      title: f.title,
      file_path: f.filePath ?? '',
      line: f.line ?? null,
      tool: f.tool,
      severity: f.severity,
    })),
  };

  return Buffer.from(JSON.stringify(input)).toString('base64');
}

/**
 * Run the verification agent via SSH and parse its verdicts. The AI run
 * succeeded when we get here — a missing/corrupt output file is lost output
 * and throws (the pipeline treats this step as required when triage is on).
 */
export async function runMitigationAgent(
  ctx: PipelineContext,
  inputB64: string,
): Promise<{ decisions: MitigationDecisionPlan[]; aiUsage?: AiUsage }> {
  const { agentDir } = ctx;

  const inputPath = `${agentDir}/mitigation-input.json`;
  await sshWriteFile(getClaudeRunnerConfig(), inputPath, Buffer.from(inputB64, 'base64'), ctx.cancelSignal);

  const langLine = getLanguageInstruction(ctx.reportLanguage);
  const prompt = [
    langLine,
    `Verify which previously-found vulnerabilities are FIXED in the current code.`,
    '',
    `Input:`,
    `- Candidates: ${inputPath}`,
    `- Scan context: ${ctx.scanContextPath}`,
    `- Tool results: ${ctx.toolsDir}/`,
    `- Repository: ${ctx.repoPath}`,
    '',
    `Output:`,
    `- Verdicts: ${agentDir}/mitigation-output.json`,
    '',
    `Rules:`,
    `- Read the actual source code for EVERY candidate before deciding`,
    `- Return a verdict for EVERY candidate — do not skip any`,
    `- When unsure, verdict 'unverifiable' — NEVER guess 'fixed'`,
  ].filter(Boolean).join('\n');

  const modelId = resolveModelFlag(ctx.aiModelTriage, 'opus');
  const claudeArgs = `-p --model ${modelId} --verbose --append-system-prompt-file /prompts/mitigation-check.md --output-format stream-json --dangerously-skip-permissions`;

  let aiUsage: AiUsage | undefined;
  try {
    const { stdout, parsed } = await runClaudeWithTrace({
      scanId: ctx.scanId,
      wave: 'mitigation-check',
      prompt,
      claudeArgs,
      inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
      maxTimeoutMs: AI_MAX_TIMEOUT_MS,
      cancelSignal: ctx.cancelSignal,
    });
    await addScanFile({ scanId: ctx.scanId, fileName: 'mitigation.log', fileType: 'log-mitigation', content: stdout });
    aiUsage = extractAiUsage(parsed);
  } catch (err) {
    if (err instanceof SSHTimeoutError && err.stdout) {
      await addScanFile({ scanId: ctx.scanId, fileName: 'mitigation.log', fileType: 'log-mitigation', content: err.stdout }).catch(() => {});
    }
    throw err;
  }

  const outputPath = `${agentDir}/mitigation-output.json`;
  let raw: string;
  try {
    raw = await fs.readFile(outputPath, 'utf8');
  } catch {
    throw new Error(`mitigation-output.json missing at ${outputPath} after successful AI mitigation run — verdicts were lost`);
  }

  let decisions: MitigationDecisionPlan[];
  try {
    const parsed = JSON.parse(raw);
    decisions = parsed.decisions ?? [];
  } catch (err) {
    throw new Error(`Failed to parse mitigation-output.json: ${err instanceof Error ? err.message : String(err)}. First 200 chars: ${raw.slice(0, 200)}`);
  }

  return { decisions, aiUsage };
}

// ── StepFn wrapper ──────────────────────────────────────────────────
// NO repo-data writes here: verdicts are emitted in the step output
// (resume-safe via scan_steps.output) and applied by the final 'commit' step.

const skipOutput = (skipReason: NonNullable<MitigationCheckOutput['skipReason']>): MitigationCheckOutput => ({
  skipped: true,
  skipReason,
  candidates: 0,
  confirmedFixed: 0,
  stillPresent: 0,
  unverifiable: 0,
  durationMs: 0,
  mitigationDecisions: [],
});

export async function runMitigationCheckStep({ ctx, prev }: StepInput): Promise<MitigationCheckOutput> {
  if (!ctx.aiTriageEnabled) {
    console.log(`[mitigation] AI triage disabled for workspace ${ctx.workspaceId}, skipping`);
    return skipOutput('ai-triage-disabled');
  }
  // PR scans cover a branch subset — "not re-detected" is meaningless there.
  if (ctx.scanType === 'pr') {
    return skipOutput('pr-scan');
  }
  if (!prev.aiAvailable) {
    return skipOutput('analysis-failed');
  }

  const start = Date.now();
  const preparedFindings = (prev.preparedFindings ?? []) as PreparedFinding[];
  const decisions = (prev.decisions ?? []) as TriageDecisionPlan[];
  const repositoryId = (prev.repositoryId as number) ?? ctx.repositoryId;

  const ranTools = resolveRanTools(prev);
  const matchedIds = collectMatchedFindingIds(preparedFindings, decisions);
  const candidates = await fetchMitigationCandidates(ctx, repositoryId, ranTools, matchedIds);

  if (candidates.length === 0) {
    // Nothing to verify (first scan, or every old finding was re-detected).
    return {
      candidates: 0,
      confirmedFixed: 0,
      stillPresent: 0,
      unverifiable: 0,
      durationMs: Date.now() - start,
      mitigationDecisions: [],
    };
  }

  const inputB64 = prepareMitigationInput(ctx, candidates, preparedFindings)!;
  const { decisions: agentDecisions, aiUsage } = await runMitigationAgent(ctx, inputB64);

  // Validate agent verdicts: unknown ids and unknown verdicts are dropped with
  // a warning; candidates the agent never verdicted become 'unverifiable'.
  // Every candidate ends up with exactly one decision in the output.
  const candidateIds = new Set(candidates.map(c => c.id));
  const validated = new Map<number, MitigationDecisionPlan>();
  for (const d of agentDecisions) {
    let problem: string | null = null;
    if (!Number.isInteger(d.finding_id) || !candidateIds.has(d.finding_id)) {
      problem = `finding ${d.finding_id} is not in the offered candidate set`;
    } else if (!VALID_VERDICTS.has(d.verdict)) {
      problem = `unknown verdict '${d.verdict}' for finding ${d.finding_id}`;
    } else if (validated.has(d.finding_id)) {
      problem = `duplicate verdict for finding ${d.finding_id} (first wins)`;
    }
    if (problem) {
      const message = `Ignoring invalid mitigation verdict: ${problem}`;
      console.warn(`[mitigation] ${message}`);
      await logMitigationScanEvent(ctx, 'warning', message, { findingId: d.finding_id, verdict: d.verdict });
      continue;
    }
    validated.set(d.finding_id, { finding_id: d.finding_id, verdict: d.verdict, reason: d.reason ?? '' });
  }

  for (const c of candidates) {
    if (validated.has(c.id)) continue;
    const message = `Agent returned no verdict for candidate finding #${c.id} (${c.title}) — treating as unverifiable, it stays open`;
    console.warn(`[mitigation] ${message}`);
    await logMitigationScanEvent(ctx, 'warning', message, { findingId: c.id });
    validated.set(c.id, { finding_id: c.id, verdict: 'unverifiable', reason: 'Agent returned no verdict for this finding' });
  }

  const mitigationDecisions = [...validated.values()];
  const confirmedFixed = mitigationDecisions.filter(d => d.verdict === 'fixed').length;
  const stillPresent = mitigationDecisions.filter(d => d.verdict === 'still_present').length;
  const unverifiable = mitigationDecisions.filter(d => d.verdict === 'unverifiable').length;

  // A still-present finding means the vulnerability is ALIVE in the code but
  // this scan's tools missed it — that is a scanner regression, scream.
  const candidateById = new Map(candidates.map(c => [c.id, c]));
  for (const d of mitigationDecisions) {
    if (d.verdict !== 'still_present') continue;
    const c = candidateById.get(d.finding_id)!;
    await logMitigationScanEvent(
      ctx, 'error',
      `Finding #${d.finding_id} (${c.tool}: ${c.title}) is still present in the code but was NOT detected by this scan — possible scanner regression. ${d.reason}`,
      { findingId: d.finding_id, tool: c.tool, filePath: c.filePath },
    );
  }

  await logMitigationScanEvent(
    ctx, 'info',
    `Mitigation check: ${candidates.length} candidates verified — ${confirmedFixed} confirmed fixed, ${stillPresent} still present, ${unverifiable} unverifiable`,
    { candidates: candidates.length, confirmedFixed, stillPresent, unverifiable },
  );

  return {
    candidates: candidates.length,
    confirmedFixed,
    stillPresent,
    unverifiable,
    durationMs: Date.now() - start,
    aiUsage,
    mitigationDecisions,
  };
}
