import fs from 'node:fs/promises';
import { eq, and, asc, desc, getTableColumns, sql } from 'drizzle-orm';
import { sshExec, sshWriteFile, getClaudeRunnerConfig, parseStreamJsonResult, SSHTimeoutError, type SSHExecOptions } from '../ssh.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS } from '../pipeline-types.ts';
import type { PipelineContext, StepInput, TriageReportOutput, ResultFile } from '../pipeline-types.ts';
import { getLanguageInstruction } from '../prompt-languages.ts';
import { riskAcceptFinding, falsePositiveFinding, duplicateFinding, addFindingNote, addScanFile } from '../entities.ts';
import { findOrCreateContributor } from '../../routes/contributors.ts';
import { storeReports, ingestContributorStats } from './finalize.ts';
import { db } from '../../db/index.ts';
import { findings, tests, contributorAssessments } from '../../db/schema.ts';

export interface TriageDecision {
  finding_id: number;
  action: 'risk_accept' | 'false_positive' | 'duplicate' | 'keep';
  reason: string;
  contributor_email?: string;
  contributor_name?: string;
}

export interface TriageOutput {
  decisions: TriageDecision[];
  reportContent: string;
  profileContent: string;
  devAssessments: unknown[];
}

async function readFileOrDefault(path: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return fallback;
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

export async function prepareTriageInput(
  ctx: PipelineContext,
  repositoryId: number,
  resultFiles: ResultFile[],
  emailAliases?: Record<string, string[]>,
): Promise<string | null> {
  // Fetch active findings from BEAST DB
  const allFindings = await db.select({
    ...getTableColumns(findings),
    testTool: tests.tool,
  })
    .from(findings)
    .innerJoin(tests, eq(tests.id, findings.testId))
    .where(and(eq(findings.repositoryId, repositoryId), eq(findings.status, 'open')))
    .orderBy(asc(findings.id));
  if (allFindings.length === 0) return null;

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
  const triageFindings = allFindings.map((f) => {
    const tool = f.tool || f.testTool || 'unknown';
    const ruleId = f.vulnIdFromTool || '';
    const entry: Record<string, unknown> = {
      id: f.id,
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

    return entry;
  });

  // Fetch baseline assessments for contributors in this repo
  const baselineAssessments = await fetchBaselineAssessments(ctx.repoName);

  const triageInput: Record<string, unknown> = {
    repo_name: ctx.repoName,
    repo_path: ctx.repoPath,
    profile_path: ctx.profilePath,
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
    await sshWriteFile(getClaudeRunnerConfig(), triageInputPath, Buffer.from(findingsB64, 'base64'));
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
    `- Profile: ${ctx.profilePath}`,
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
  const command = `echo ${JSON.stringify(prompt)} | claude -p --verbose --append-system-prompt-file /prompts/triage-and-report.md --output-format stream-json --dangerously-skip-permissions`;

  let sshResult;
  try {
    sshResult = await sshExec(getClaudeRunnerConfig(), command, {
      inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
      maxTimeoutMs: AI_MAX_TIMEOUT_MS,
    });
    await addScanFile({ scanId: ctx.scanId, fileName: 'triage.log', fileType: 'log-triage', content: sshResult.stdout });
  } catch (err) {
    if (err instanceof SSHTimeoutError && err.stdout) {
      await addScanFile({ scanId: ctx.scanId, fileName: 'triage.log', fileType: 'log-triage', content: err.stdout }).catch(() => {});
    }
    throw err;
  }

  // Read output files directly from the shared volume
  const triageJson = await readFileOrDefault(`${agentDir}/triage-output.json`, '{"decisions":[]}');
  const reportContent = await readFileOrDefault(`${agentDir}/final-report.md`, '');
  let profileContent = await readFileOrDefault(ctx.profilePath, '');
  const assessmentsJson = await readFileOrDefault(
    `${toolsDir}/contributor-assessments.json`,
    '[]',
  );

  // Parse JSON outputs
  let decisions: TriageDecision[] = [];
  try {
    const parsed = JSON.parse(triageJson);
    decisions = parsed.decisions || [];
  } catch (err) {
    console.error('[triage] Failed to parse triage-output.json:', err instanceof Error ? err.message : err);
  }

  let devAssessments: unknown[] = [];
  try {
    const parsed = JSON.parse(assessmentsJson);
    if (Array.isArray(parsed) && parsed.length > 0) devAssessments = parsed;
  } catch (err) {
    console.error('[triage] Failed to parse contributor-assessments.json:', err instanceof Error ? err.message : err);
  }

  // Strip embedded contributor-assessments block from profile before storing
  profileContent = profileContent.replace(/```contributor-assessments[\s\S]*?```/g, '').trim();

  return { decisions, reportContent, profileContent, devAssessments };
}

const DISMISS_ACTIONS: Record<string, {
  apply: (id: number, reason: string) => Promise<unknown>;
  label: string;
}> = {
  risk_accept: { apply: riskAcceptFinding, label: 'Risk accepted' },
  false_positive: { apply: falsePositiveFinding, label: 'False positive' },
  duplicate: { apply: duplicateFinding, label: 'Duplicate' },
};

export async function applyTriageDecisions(
  decisions: TriageDecision[],
): Promise<number> {
  let dismissed = 0;
  for (const d of decisions) {
    const handler = DISMISS_ACTIONS[d.action];
    if (!handler) continue;
    try {
      await handler.apply(d.finding_id, d.reason);
      await addFindingNote({
        findingId: d.finding_id,
        author: 'beast-triage',
        noteType: 'triage',
        content: `[Auto-Triage] ${handler.label}: ${d.reason}`,
      });
      dismissed++;
    } catch (err) {
      console.error(`[triage] Failed to apply triage decision for finding ${d.finding_id}:`, err instanceof Error ? err.message : err);
    }
  }
  return dismissed;
}

// ── StepFn wrapper ──────────────────────────────────────────────────

export async function runTriageStep({ ctx, prev }: StepInput): Promise<TriageReportOutput> {
  if (!ctx.aiTriageEnabled) {
    console.log(`[triage] AI triage disabled for workspace ${ctx.workspaceId}, skipping`);
    return { triaged: 0, dismissed: 0, kept: 0, reportsGenerated: false, assessmentsEnhanced: 0, durationMs: 0 };
  }
  if (!prev.aiAvailable) {
    return { triaged: 0, dismissed: 0, kept: 0, reportsGenerated: false, assessmentsEnhanced: 0, durationMs: 0 };
  }

  const start = Date.now();
  const repositoryId = prev.repositoryId as number;
  const workspaceId = prev.workspaceId as number;
  const resultFiles = (prev.resultFiles ?? []) as ResultFile[];

  // 1. Prepare triage input (fetch active findings, enrich with tool metadata)
  const emailAliases = (prev.emailAliases ?? {}) as Record<string, string[]>;
  const findingsB64 = await prepareTriageInput(ctx, repositoryId, resultFiles, emailAliases);

  // 2. Run triage agent via SSH (writes input via SFTP, reads output from shared volume)
  const triageOutput = await runTriageAndReport(ctx, findingsB64);

  // 3. Apply triage decisions (dismiss false positives, duplicates, risk-accepted)
  const dismissed = await applyTriageDecisions(triageOutput.decisions);

  // 4. Attribute findings to contributors
  for (const d of triageOutput.decisions) {
    if (!d.contributor_email || d.action === 'risk_accept') continue;
    try {
      const name = d.contributor_name || d.contributor_email.split('@')[0];
      const contribId = await findOrCreateContributor(d.contributor_email, name, ctx.workspaceId);
      await db.update(findings).set({ contributorId: contribId }).where(eq(findings.id, d.finding_id));
    } catch (err) {
      console.error(`[triage] Failed to attribute finding ${d.finding_id}:`, err instanceof Error ? err.message : err);
    }
  }

  // 5. Store reports (profile + final report as scan files)
  await storeReports(ctx.scanId, triageOutput.reportContent, triageOutput.profileContent);

  // 6. Append Security Findings section to existing assessments (from analyzer)
  if (triageOutput.devAssessments.length > 0) {
    for (const a of triageOutput.devAssessments as any[]) {
      const email = a.contributor_email || a.email || '';
      if (!email) continue;
      try {
        const { findOrCreateContributor: findContrib } = await import('../../routes/contributors.ts');
        const contribId = await findContrib(email, a.contributor_name || email.split('@')[0], ctx.workspaceId);

        // Extract ONLY the "### Security Findings" section from triage feedback
        const rawFeedback = a.feedback || '';
        const secMatch = rawFeedback.match(/### Security Findings[\s\S]*/);
        const securitySection = secMatch ? secMatch[0].trim() : '';
        if (!securitySection) continue; // Nothing to append

        // Find existing assessment for this repo
        const [existing] = await db.select({ id: contributorAssessments.id, feedback: contributorAssessments.feedback })
          .from(contributorAssessments)
          .where(and(eq(contributorAssessments.contributorId, contribId), eq(contributorAssessments.repoName, ctx.repoName)))
          .orderBy(desc(contributorAssessments.assessedAt))
          .limit(1);

        if (existing) {
          // Strip old security section and append new one
          const currentFeedback = existing.feedback || '';
          const withoutOldSecurity = currentFeedback.replace(/\n*### Security Findings[\s\S]*$/, '').trim();
          const updatedFeedback = withoutOldSecurity + '\n\n' + securitySection;
          await db.update(contributorAssessments).set({ feedback: updatedFeedback }).where(eq(contributorAssessments.id, existing.id));
        } else {
          // No analyzer assessment exists — create one with just security findings
          await db.insert(contributorAssessments).values({
            contributorId: contribId,
            repoName: ctx.repoName,
            executionId: ctx.scanId,
            feedback: securitySection,
          });
        }
      } catch (err) {
        console.error(`[triage] Failed to append security findings for ${email}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  const kept = triageOutput.decisions.filter(d => d.action === 'keep').length;

  return {
    triaged: triageOutput.decisions.length,
    dismissed,
    kept,
    reportsGenerated: true,
    assessmentsEnhanced: triageOutput.devAssessments.length,
    durationMs: Date.now() - start,
  };
}
