import fs from 'node:fs/promises';
import { sql, and, eq, desc, inArray } from 'drizzle-orm';
import { sshWriteFile, getClaudeRunnerConfig, extractAiUsage, SSHTimeoutError } from '../ssh.ts';
import { runClaudeWithTrace } from '../ai-trace.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS } from '../pipeline-types.ts';
import type {
  PipelineContext, StepInput, TriageReportOutput, ResultFile, AiUsage,
  PreparedFinding, TriageDecisionPlan,
} from '../pipeline-types.ts';
import { getLanguageInstruction } from '../prompt-languages.ts';
import { resolveModelFlag } from '../ai-models.ts';
import { addScanFile } from '../entities.ts';
import { storeReports } from './import-results.ts';
import { db } from '../../db/index.ts';
import { scanEvents, findings } from '../../db/schema.ts';

// Decisions are keyed by PreparedFinding.tempId — DB finding ids don't exist
// yet (the commit step writes findings only after every step succeeded).
export type TriageDecision = TriageDecisionPlan;

export interface TriageOutput {
  decisions: TriageDecision[];
  reportContent: string;
  devAssessments: unknown[];
  /** Human-readable descriptions of missing/corrupt AI output files. Each is also recorded as an error scan event. */
  anomalies: string[];
  aiUsage?: AiUsage;
}

/** Returns null when the file is missing/unreadable — callers must decide whether that is an anomaly. */
async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

// Local scan-event helper (mirrors import-results; avoids circular dep with pipeline.ts)
async function logTriageScanEvent(
  ctx: PipelineContext,
  level: 'info' | 'warning' | 'error',
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(scanEvents).values({
      scanId: ctx.scanId,
      stepName: 'triage-report',
      level,
      source: 'triage-report',
      message,
      details: details ?? {},
      repoName: ctx.repoName ?? null,
      workspaceId: ctx.workspaceId ?? null,
    });
  } catch (err) {
    console.error(`[triage] Failed to log scan event for ${ctx.scanId}:`, err instanceof Error ? err.message : err);
  }
}

export async function fetchBaselineAssessments(repoName: string) {
  try {
    const rows = await db.execute(sql`
      SELECT ca.contributor_id, c.emails as email, c.display_name,
        ca.score_security, ca.score_quality, ca.score_patterns, ca.score_testing,
        ca.feedback
      FROM contributor_assessments ca
      INNER JOIN contributors c ON c.id = ca.contributor_id
      WHERE ca.repo_name = ${repoName}
    `);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('[triage] Failed to fetch baseline assessments:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Semantic cross-scan matching for AI findings ────────────────────
// AI-generated findings (tool='beast') can NEVER match across scans by
// fingerprint: titles are rephrased every run, lines shift, vulnId is absent.
// Instead, the triage agent semantically matches this scan's prepared AI
// findings against the repo's EXISTING AI findings and returns `same_as`
// decisions; the commit step then UPDATES those rows instead of inserting
// duplicates. Deterministic tools keep their fingerprint flow untouched.

/** Existing AI finding offered to the triage agent as a semantic-match target. */
export interface SemanticMatchCandidate {
  id: number;
  title: string;
  filePath: string | null;
  severity: string;
  description: string | null;
}

/** Newest-first cap on candidates sent to the agent (prompt size guard). */
export const SEMANTIC_CANDIDATE_LIMIT = 200;

/** Statuses whose rows must keep matching across scans: open ones get
 *  refreshed, manually dismissed ones (risk_accepted/false_positive) must be
 *  recognized so re-scans don't resurrect them as new duplicates. */
const SEMANTIC_CANDIDATE_STATUSES = ['open', 'risk_accepted', 'false_positive'];

/**
 * READ-ONLY: fetch the repo's existing AI ('beast') findings eligible as
 * semantic-match targets. Failures degrade to "no candidates" (triage then
 * simply treats everything as new — the pre-existing behavior).
 */
export async function fetchSemanticMatchCandidates(
  ctx: PipelineContext,
  repositoryId: number | undefined,
): Promise<SemanticMatchCandidate[]> {
  if (!repositoryId) return [];
  try {
    const rows = await db.select({
      id: findings.id,
      title: findings.title,
      filePath: findings.filePath,
      severity: findings.severity,
      description: findings.description,
    })
      .from(findings)
      .where(and(
        eq(findings.repositoryId, repositoryId),
        eq(findings.tool, 'beast'),
        inArray(findings.status, SEMANTIC_CANDIDATE_STATUSES),
      ))
      .orderBy(desc(findings.id))
      .limit(SEMANTIC_CANDIDATE_LIMIT + 1); // +1 to detect truncation
    if (!Array.isArray(rows)) return [];
    if (rows.length > SEMANTIC_CANDIDATE_LIMIT) {
      const message = `Semantic-match candidates truncated to the ${SEMANTIC_CANDIDATE_LIMIT} newest AI findings — older open AI findings will not be matched this scan`;
      console.warn(`[triage] ${message}`);
      await logTriageScanEvent(ctx, 'warning', message, { limit: SEMANTIC_CANDIDATE_LIMIT });
      return rows.slice(0, SEMANTIC_CANDIDATE_LIMIT);
    }
    return rows;
  } catch (err) {
    console.error('[triage] Failed to fetch semantic-match candidates:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function prepareTriageInput(
  ctx: PipelineContext,
  preparedFindings: PreparedFinding[],
  resultFiles: ResultFile[],
  emailAliases?: Record<string, string[]>,
  existingAiFindings?: SemanticMatchCandidate[],
): Promise<string | null> {
  // Triage operates on the PREPARED plan, not the DB — nothing has been
  // committed yet. Findings are keyed by their temp ids.
  if (preparedFindings.length === 0) return null;

  // Parse SARIF confidence and trufflehog metadata from result files
  const sarifConfidence: Record<string, string> = {};
  const trufflehogMeta: Record<string, { verified: boolean; detector: string }> = {};

  for (const rf of resultFiles) {
    const content = Buffer.from(rf.content_b64, 'base64').toString('utf8');

    if (rf.key === 'code-analysis' || rf.key === 'jf-audit') {
      try {
        const sarif = JSON.parse(content);
        const results = sarif?.runs?.[0]?.results ?? [];
        for (const r of results) {
          if (r.properties?.confidence) {
            sarifConfidence[r.ruleId] = r.properties.confidence;
          }
        }
      } catch (err) {
        console.error(`[triage] Failed to parse SARIF confidence from ${rf.key}:`, err instanceof Error ? err.message : err);
      }
    }

    if (rf.key === 'trufflehog') {
      try {
        const jsonLines = content.split('\n').filter((l: string) => l.trim());
        for (const line of jsonLines) {
          if (line.trim() === '[]') continue;
          const f = JSON.parse(line);
          const fp = f?.SourceMetadata?.Data?.Filesystem?.file ?? '';
          if (fp) {
            if (!trufflehogMeta[fp] || f.Verified) {
              trufflehogMeta[fp] = { verified: !!f.Verified, detector: f.DetectorName || '' };
            }
          }
        }
      } catch (err) {
        console.error(`[triage] Failed to parse trufflehog metadata:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Format findings for triage agent
  const triageFindings = preparedFindings.map((f) => {
    const tool = f.tool || 'unknown';
    const ruleId = f.vulnIdFromTool || '';
    const entry: Record<string, unknown> = {
      id: f.tempId,
      title: f.title,
      severity: f.severity,
      description: (f.description || '').slice(0, 500),
      file_path: f.filePath || '',
      line: f.line || null,
      tool,
      vuln_id: ruleId,
    };

    if ((tool === 'beast' || tool === 'jfrog') && sarifConfidence[ruleId]) {
      entry.confidence = sarifConfidence[ruleId];
    }
    if (tool === 'trufflehog' && f.filePath && trufflehogMeta[f.filePath]) {
      entry.verified = trufflehogMeta[f.filePath].verified;
      entry.detector = trufflehogMeta[f.filePath].detector;
    }
    if (f.category === 'secrets' && f.secretValue) {
      entry.secret_value = f.secretValue;
    }
    if (f.codeSnippet) {
      entry.code_context = f.codeSnippet;
    }

    return entry;
  });

  // Fetch baseline assessments for contributors in this repo
  const baselineAssessments = await fetchBaselineAssessments(ctx.repoName);

  const triageInput: Record<string, unknown> = {
    repo_name: ctx.repoName,
    repo_path: ctx.repoPath,
    scan_context_path: ctx.scanContextPath,
    results_dir: ctx.resultsDir,
    findings: triageFindings,
    baseline_assessments: baselineAssessments.map((a: any) => ({
      email: Array.isArray(a.email) ? a.email[0] : a.email,
      name: a.display_name,
      score_security: a.score_security,
      score_quality: a.score_quality,
      score_patterns: a.score_patterns,
      score_testing: a.score_testing,
      feedback: a.feedback || '',
    })),
  };

  // Include email aliases so the agent knows which emails belong to the same contributor
  if (emailAliases && Object.keys(emailAliases).length > 0) {
    triageInput.email_aliases = emailAliases;
  }

  // Existing AI findings from previous scans — semantic-match targets for
  // this scan's 'beast' findings (compact: keep the prompt small).
  if (existingAiFindings && existingAiFindings.length > 0) {
    triageInput.existing_ai_findings = existingAiFindings.map((c) => ({
      id: c.id,
      title: c.title,
      file_path: c.filePath ?? '',
      severity: c.severity,
      description: (c.description ?? '').slice(0, 300),
    }));
  }

  return Buffer.from(JSON.stringify(triageInput)).toString('base64');
}

export async function runTriageAndReport(
  ctx: PipelineContext,
  findingsB64: string | null,
): Promise<TriageOutput> {
  const { agentDir, toolsDir } = ctx;

  // Write triage input if we have findings
  if (findingsB64) {
    const triageInputPath = `${agentDir}/triage-input.json`;
    await sshWriteFile(getClaudeRunnerConfig(), triageInputPath, Buffer.from(findingsB64, 'base64'), ctx.cancelSignal);
  }

  const triageArg = findingsB64 ? `${agentDir}/triage-input.json` : 'NONE';

  // Build structured prompt with language instruction at the top
  const langLine = getLanguageInstruction(ctx.reportLanguage);
  const prompt = [
    langLine,
    `Triage all security findings, then generate a consolidated report.`,
    '',
    `Input:`,
    `- Findings: ${triageArg}`,
    `- Scan context: ${ctx.scanContextPath}`,
    `- Tool results: ${toolsDir}/`,
    `- Repository: ${ctx.repoPath}`,
    '',
    `Output:`,
    `- Triage decisions: ${agentDir}/triage-output.json`,
    `- Report: ${agentDir}/final-report.md`,
    `- Assessments: ${toolsDir}/contributor-assessments.json`,
    '',
    `Rules:`,
    `- Read the actual source code for EVERY finding before deciding`,
    `- Triage EVERY finding — do not skip any`,
    `- Use git blame to attribute 'keep' findings to contributors`,
  ].filter(Boolean).join('\n');

  // Run Claude — it writes output files directly to the shared volume
  const modelId = resolveModelFlag(ctx.aiModelTriage, 'opus');
  const claudeArgs = `-p --model ${modelId} --verbose --append-system-prompt-file /prompts/triage-and-report.md --output-format stream-json --dangerously-skip-permissions`;

  let aiUsage: AiUsage | undefined;
  try {
    const { stdout, parsed } = await runClaudeWithTrace({
      scanId: ctx.scanId,
      wave: 'triage-report',
      prompt,
      claudeArgs,
      inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
      maxTimeoutMs: AI_MAX_TIMEOUT_MS,
      cancelSignal: ctx.cancelSignal,
    });
    await addScanFile({ scanId: ctx.scanId, fileName: 'triage.log', fileType: 'log-triage', content: stdout });
    aiUsage = extractAiUsage(parsed);
  } catch (err) {
    if (err instanceof SSHTimeoutError && err.stdout) {
      await addScanFile({ scanId: ctx.scanId, fileName: 'triage.log', fileType: 'log-triage', content: err.stdout }).catch(() => {});
    }
    throw err;
  }

  // Read output files directly from the shared volume. The AI invocation
  // SUCCEEDED at this point, so a missing/corrupt output file is an anomaly
  // that must scream — "AI produced nothing" must be distinguishable from
  // "file lost".
  const anomalies: string[] = [];
  const triageJson = await readFileOrNull(`${agentDir}/triage-output.json`);
  const reportContent = (await readFileOrNull(`${agentDir}/final-report.md`)) ?? '';
  const assessmentsJson = await readFileOrNull(`${toolsDir}/contributor-assessments.json`);

  // Parse JSON outputs
  let decisions: TriageDecision[] = [];
  if (triageJson === null || !triageJson.trim()) {
    // Only an anomaly when there were findings to triage — with no findings
    // the agent legitimately has nothing to decide on.
    if (findingsB64) {
      anomalies.push(`triage-output.json missing or empty at ${agentDir}/triage-output.json after successful AI triage run — triage decisions were lost`);
    }
  } else {
    try {
      const parsed = JSON.parse(triageJson);
      decisions = parsed.decisions || [];
    } catch (err) {
      anomalies.push(`Failed to parse triage-output.json: ${err instanceof Error ? err.message : String(err)}. First 200 chars: ${triageJson.slice(0, 200)}`);
    }
  }

  if (!reportContent.trim()) {
    anomalies.push(`final-report.md missing or empty at ${agentDir}/final-report.md after successful AI triage run — no report generated`);
  }

  let devAssessments: unknown[] = [];
  if (assessmentsJson !== null) {
    try {
      const parsed = JSON.parse(assessmentsJson);
      if (Array.isArray(parsed) && parsed.length > 0) devAssessments = parsed;
    } catch (err) {
      anomalies.push(`Failed to parse contributor-assessments.json: ${err instanceof Error ? err.message : String(err)}. First 200 chars: ${assessmentsJson.slice(0, 200)}`);
    }
  }

  for (const message of anomalies) {
    console.error(`[triage] ${message}`);
    await logTriageScanEvent(ctx, 'error', message);
  }

  // Triage was supposed to produce this output and didn't — fail the scan
  // (the pipeline treats triage as required when the workspace toggle is on)
  // instead of completing with silently lost decisions/report.
  if (anomalies.length > 0) {
    throw new Error(`Triage output incomplete: ${anomalies.join(' | ')}`);
  }

  return { decisions, reportContent, devAssessments, anomalies, aiUsage };
}

const DISMISS_ACTIONS = new Set(['risk_accept', 'false_positive', 'duplicate']);

// ── StepFn wrapper ──────────────────────────────────────────────────
// NO repo-data writes here: decisions and assessment enhancements are emitted
// in the step output (resume-safe via scan_steps.output) and applied to the
// DB by the final 'commit' step. Only scan_files diagnostics (triage.log,
// final-report.md) are stored mid-scan.

export async function runTriageStep({ ctx, prev }: StepInput): Promise<TriageReportOutput> {
  // Skips carry an explicit skipReason (mirrors ai-research's skipped/skipReason)
  // so the step output shows WHY everything is zero instead of bare zeroes.
  if (!ctx.aiTriageEnabled) {
    console.log(`[triage] AI triage disabled for workspace ${ctx.workspaceId}, skipping`);
    return { skipped: true, skipReason: 'ai-triage-disabled', triaged: 0, dismissed: 0, kept: 0, reportsGenerated: false, assessmentsEnhanced: 0, durationMs: 0, decisions: [], devAssessments: [] };
  }
  if (!prev.aiAvailable) {
    return { skipped: true, skipReason: 'analysis-failed', triaged: 0, dismissed: 0, kept: 0, reportsGenerated: false, assessmentsEnhanced: 0, durationMs: 0, decisions: [], devAssessments: [] };
  }

  const start = Date.now();
  const resultFiles = (prev.resultFiles ?? []) as ResultFile[];
  const preparedFindings = (prev.preparedFindings ?? []) as PreparedFinding[];

  // 1. Prepare triage input from the PREPARED plan, enriched with tool metadata.
  //    When this scan produced AI findings, also offer the repo's existing AI
  //    findings as semantic-match targets (fingerprints never match for AI).
  const emailAliases = (prev.emailAliases ?? {}) as Record<string, string[]>;
  const repositoryId = (prev.repositoryId as number) ?? ctx.repositoryId;
  const hasAiFindings = preparedFindings.some(f => f.tool === 'beast');
  const semanticCandidates = hasAiFindings
    ? await fetchSemanticMatchCandidates(ctx, repositoryId)
    : [];
  const findingsB64 = await prepareTriageInput(ctx, preparedFindings, resultFiles, emailAliases, semanticCandidates);

  // 2. Run triage agent via SSH (writes input via SFTP, reads output from shared volume)
  const triageOutput = await runTriageAndReport(ctx, findingsB64);

  // 2b. Validate semantic `same_as` matches: must be an integer id from the
  //     candidate set, and the SOURCE prepared finding must itself be an AI
  //     ('beast') finding. Anything else → warn + treat as new (strip same_as).
  const candidateIds = new Set(semanticCandidates.map(c => c.id));
  const beastTempIds = new Set(preparedFindings.filter(f => f.tool === 'beast').map(f => f.tempId));
  for (const d of triageOutput.decisions) {
    if (d.same_as == null) continue;
    let problem: string | null = null;
    if (!Number.isInteger(d.same_as)) {
      problem = `same_as '${d.same_as}' is not an integer`;
    } else if (!beastTempIds.has(d.finding_id)) {
      problem = `finding ${d.finding_id} is not an AI ('beast') finding — semantic matching applies to AI findings only`;
    } else if (!candidateIds.has(d.same_as)) {
      problem = `same_as ${d.same_as} is not in the offered candidate set`;
    }
    if (problem) {
      const message = `Ignoring invalid semantic match for finding ${d.finding_id}: ${problem} — treating as new`;
      console.warn(`[triage] ${message}`);
      await logTriageScanEvent(ctx, 'warning', message, { findingId: d.finding_id, sameAs: d.same_as });
      delete d.same_as;
    }
  }

  // 3. Store the final report (scan_files — diagnostic record, allowed mid-scan)
  await storeReports(ctx.scanId, triageOutput.reportContent);

  const dismissed = triageOutput.decisions.filter(d => DISMISS_ACTIONS.has(d.action)).length;
  const kept = triageOutput.decisions.filter(d => d.action === 'keep').length;

  return {
    triaged: triageOutput.decisions.length,
    // Decisions that WILL dismiss findings when the commit step applies them
    dismissed,
    kept,
    // Reflect reality — an empty/missing final report must not be reported as generated
    reportsGenerated: triageOutput.reportContent.trim().length > 0,
    assessmentsEnhanced: triageOutput.devAssessments.length,
    durationMs: Date.now() - start,
    aiUsage: triageOutput.aiUsage,
    decisions: triageOutput.decisions,
    devAssessments: triageOutput.devAssessments,
  };
}
