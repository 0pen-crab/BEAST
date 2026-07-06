// Final pipeline step: COMMIT the prepared scan results to the database.
//
// Maintainer policy: "Все заливається тільки коли скан успішно завершився" —
// scan-produced repo data (findings, tests, contributor stats, contributor
// assessments) is written ONLY here, after every other step has succeeded.
// The import step prepares the plan, the triage step decides on it; this step
// is the single place where that plan becomes rows.
//
// Atomicity:
//   - tests + findings + finding notes + triage dispositions + duplicate_of
//     links are written in ONE db.transaction — a failure rolls back all of it.
//   - contributor stats/assessments go through the shared ingestContributors
//     upsert path AFTER the transaction (it is reused by the HTTP ingest route
//     and is not transaction-aware). It screams to scan/workspace events on
//     failure but does not throw — mirroring its long-standing semantics.
//   - the step is IDEMPOTENT: a resume that re-runs commit (e.g. worker crash
//     mid-commit) first wipes whatever a previous attempt wrote for this scan
//     (same FK-safe order as cleanup.ts) and re-commits the plan.
//
// A finding enters the DB already triaged: its status and dismiss reason come
// from the triage decisions keyed by the plan's temp ids.

import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { tests, findings, findingNotes, contributorAssessments, scanEvents, scanFiles } from '../../db/schema.ts';
import { findOrCreateContributor } from '../../routes/contributors.ts';
import { addScanFile } from '../entities.ts';
import { ingestContributorStats } from './import-results.ts';
import { buildVerifiedStatsBlock, insertVerifiedStats, type CommittedFindingStat } from './verified-stats.ts';
import type {
  PipelineContext, StepInput, CommitOutput,
  PreparedTest, PreparedFinding, TriageDecisionPlan, ResultFile,
} from '../pipeline-types.ts';

const DISPOSE_LABELS: Record<string, string> = {
  risk_accept: 'Risk accepted',
  false_positive: 'False positive',
  duplicate: 'Duplicate',
};

const DISPOSE_STATUS: Record<string, string> = {
  risk_accept: 'risk_accepted',
  false_positive: 'false_positive',
  duplicate: 'duplicate',
};

// Local scan-event helper (mirrors import-results; avoids circular dep with pipeline.ts)
async function logCommitScanEvent(
  ctx: PipelineContext,
  level: 'info' | 'warning' | 'error',
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(scanEvents).values({
      scanId: ctx.scanId,
      stepName: 'commit',
      level,
      source: 'commit',
      message,
      details: details ?? {},
      repoName: ctx.repoName ?? null,
      workspaceId: ctx.workspaceId ?? null,
    });
  } catch (err) {
    console.error(`[commit] Failed to log scan event for ${ctx.scanId}:`, err instanceof Error ? err.message : err);
  }
}

// Drizzle transaction handle — same query-builder surface as `db` for our usage.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Idempotency wipe: remove whatever a PREVIOUS commit attempt of this scan
 * wrote (worker crash mid-commit → scan resumes → commit re-runs). Exact same
 * FK-safe order as cleanup.ts. Returns how many rows were removed so the
 * caller can scream about the re-commit.
 */
async function wipePreviousCommitData(tx: Tx, scanId: string): Promise<number> {
  let wiped = 0;

  const testRows = await tx.select({ id: tests.id })
    .from(tests)
    .where(eq(tests.scanId, scanId));
  const testIds = testRows.map(r => r.id);

  if (testIds.length > 0) {
    const findingRows = await tx.select({ id: findings.id })
      .from(findings)
      .where(inArray(findings.testId, testIds));
    const findingIds = findingRows.map(r => r.id);

    if (findingIds.length > 0) {
      // findings.duplicate_of is a self-FK with no ON DELETE action — detach
      // surviving references before deleting (same as cleanup.ts).
      await tx.update(findings)
        .set({ duplicateOf: null })
        .where(inArray(findings.duplicateOf, findingIds));
      // finding_notes are removed by their ON DELETE CASCADE FK.
      await tx.delete(findings).where(inArray(findings.id, findingIds));
      wiped += findingIds.length;
    }

    await tx.delete(tests).where(eq(tests.scanId, scanId));
    wiped += testIds.length;
  }

  const deletedAssessments = await tx.delete(contributorAssessments)
    .where(eq(contributorAssessments.executionId, scanId))
    .returning({ id: contributorAssessments.id });
  wiped += deletedAssessments.length;

  return wiped;
}

/**
 * Append the triage-produced "### Security Findings" section to each
 * contributor's assessment for this repo (moved here from the triage step —
 * contributor assessments are repo data). Per-item failures scream to the
 * console but do not fail the commit (long-standing semantics).
 */
export async function applyAssessmentEnhancements(
  ctx: PipelineContext,
  devAssessments: unknown[],
): Promise<void> {
  for (const a of devAssessments as any[]) {
    const email = a.contributor_email || a.email || '';
    if (!email) continue;
    try {
      const contribId = await findOrCreateContributor(email, a.contributor_name || email.split('@')[0], ctx.workspaceId);

      // Extract ONLY the "### Security Findings" section from triage feedback
      const rawFeedback = a.feedback || '';
      const secMatch = rawFeedback.match(/### Security Findings[\s\S]*/);
      const securitySection = secMatch ? secMatch[0].trim() : '';
      if (!securitySection) continue; // Nothing to append

      // Find existing assessment for this repo
      const existingRows = await db.select({ id: contributorAssessments.id, feedback: contributorAssessments.feedback })
        .from(contributorAssessments)
        .where(and(eq(contributorAssessments.contributorId, contribId), eq(contributorAssessments.repoName, ctx.repoName)))
        .orderBy(desc(contributorAssessments.assessedAt))
        .limit(1);
      const existing = existingRows[0];

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
      console.error(`[commit] Failed to append security findings for ${email}:`, err instanceof Error ? err.message : err);
    }
  }
}

// ── StepFn wrapper ──────────────────────────────────────────────────

export async function runCommitStep({ ctx, prev }: StepInput): Promise<CommitOutput> {
  const repositoryId = (prev.repositoryId as number) ?? ctx.repositoryId;
  const workspaceId = (prev.workspaceId as number) ?? ctx.workspaceId;
  const preparedTests = (prev.preparedTests ?? []) as PreparedTest[];
  const preparedFindings = (prev.preparedFindings ?? []) as PreparedFinding[];
  const decisions = (prev.decisions ?? []) as TriageDecisionPlan[];
  const devAssessments = (prev.devAssessments ?? []) as unknown[];
  const analyzerAssessments = (prev.analyzerAssessments ?? []) as unknown[];
  const resultFiles = (prev.resultFiles ?? []) as ResultFile[];

  const decisionByTempId = new Map<number, TriageDecisionPlan>();
  for (const d of decisions) decisionByTempId.set(d.finding_id, d);

  let findingsNew = 0;
  let findingsUpdated = 0;
  let dismissed = 0;
  let semanticMatches = 0;
  let wiped = 0;
  const tempToDbId = new Map<number, number>();
  // Per-severity truth for the Verified Statistics block prepended to the
  // audit report: severity + FINAL committed status of every finding.
  const committedFindingStats: CommittedFindingStat[] = [];

  // Semantic cross-scan dedup (AI findings only): triage may have matched a
  // prepared 'beast' finding to an EXISTING AI finding via `same_as`. Collect
  // the requested target ids so their current rows can be verified inside the
  // transaction. Only tool='beast' sources are eligible — enforced here, not
  // just in the prompt/triage step.
  const semanticTargetIds = new Set<number>();
  for (const f of preparedFindings) {
    if (f.tool !== 'beast' || f.matchedFindingId != null) continue;
    const d = decisionByTempId.get(f.tempId);
    if (d?.same_as != null && Number.isInteger(d.same_as)) semanticTargetIds.add(d.same_as);
  }

  // Decisions whose disposition was NOT applied because the semantically
  // matched row carries a manual disposition (risk_accepted/false_positive)
  // that must never be overwritten by a fresh auto-triage. Their auto-triage
  // notes and contributor attribution are suppressed too.
  const suppressedDecisionTempIds = new Set<number>();
  // Semantic-match problems, logged as warning scan events after the tx.
  const semanticWarnings: { message: string; details: Record<string, unknown> }[] = [];

  // ONE transaction for all scan-scoped repo data — a failure anywhere rolls
  // the whole commit back, so a failed scan leaves nothing behind.
  await db.transaction(async (tx) => {
    wiped = await wipePreviousCommitData(tx, ctx.scanId);

    // Verify semantic-match targets AFTER the wipe (their rows may have
    // changed or vanished since triage ran). Eligible targets are AI
    // ('beast') rows of THIS repository — anything else falls back to insert.
    const semanticTargets = new Map<number, { id: number; tool: string; status: string | null; riskAcceptedReason: string | null; repositoryId: number | null }>();
    if (semanticTargetIds.size > 0) {
      const rows = await tx.select({
        id: findings.id,
        tool: findings.tool,
        status: findings.status,
        riskAcceptedReason: findings.riskAcceptedReason,
        repositoryId: findings.repositoryId,
      })
        .from(findings)
        .where(inArray(findings.id, [...semanticTargetIds]));
      for (const row of rows) semanticTargets.set(row.id, row);
    }
    // First-wins claim registry: two prepared findings matching the same
    // existing row would clobber each other — the second becomes an insert.
    const claimedSemanticTargets = new Set<number>();

    // 1. Tests — created here, not in import (which only prepares them)
    const keyToTestId = new Map<string, number>();
    for (const t of preparedTests) {
      const [row] = await tx.insert(tests).values({
        scanId: ctx.scanId,
        tool: t.tool,
        scanType: t.scanType,
        testTitle: t.testTitle ?? null,
        fileName: t.fileName,
        findingsCount: t.findingsCount,
        importStatus: 'completed',
      }).returning({ id: tests.id });
      keyToTestId.set(t.key, row.id);
    }

    // 2. Findings — the WRITE side of dedup lives here: insert new findings,
    //    update + re-parent matched ones. Triage decisions are applied inline
    //    so a finding enters the DB already triaged.
    for (const f of preparedFindings) {
      const testId = keyToTestId.get(f.testKey);
      if (testId == null) {
        // Plan inconsistency — must scream and fail the scan, never write
        // findings under the wrong test.
        throw new Error(`Commit plan inconsistent: prepared finding ${f.tempId} references unknown test '${f.testKey}'`);
      }

      const decision = decisionByTempId.get(f.tempId);
      const disposedStatus = decision ? DISPOSE_STATUS[decision.action] : undefined;
      const status = disposedStatus ?? 'open';
      const riskAcceptedReason = disposedStatus ? decision!.reason : null;
      // Whether this finding's triage disposition actually lands on the row —
      // a semantic match onto a manually dismissed row preserves the manual
      // state instead (set below).
      let dispositionApplied = true;

      let dbId: number | undefined;

      if (f.matchedFindingId != null) {
        // Matched an existing finding during (read-only) prepare — update +
        // re-parent it. The row may have vanished since prepare (manual
        // delete, cleanup of another scan) — fall through to insert then.
        const updateSet: Record<string, unknown> = {
          testId,
          severity: f.severity,
          description: f.description ?? null,
          codeSnippet: f.codeSnippet ?? null,
          updatedAt: new Date(),
        };
        // Mirror upsertFinding: keep the existing category/secretValue when
        // the new parse has none.
        if (f.category != null) updateSet.category = f.category;
        if (f.secretValue != null) updateSet.secretValue = f.secretValue;

        // Manual dispositions survive re-scans (same rule as semantic matches):
        // a finding the user deliberately risk-accepted / marked false-positive
        // must NOT be reset to open with its reason wiped just because the tool
        // found the same issue again. Fresh auto-triage applies to other rows.
        const [existingRow] = await tx.select({
          status: findings.status,
          riskAcceptedReason: findings.riskAcceptedReason,
        }).from(findings).where(eq(findings.id, f.matchedFindingId));
        const manuallyDisposed = existingRow != null
          && (existingRow.status === 'risk_accepted' || existingRow.status === 'false_positive');
        if (manuallyDisposed) {
          dispositionApplied = false;
        } else {
          updateSet.status = status;
          updateSet.riskAcceptedReason = riskAcceptedReason;
        }

        const updated = await tx.update(findings)
          .set(updateSet)
          .where(eq(findings.id, f.matchedFindingId))
          .returning({ id: findings.id });
        if (updated.length > 0) {
          dbId = updated[0].id;
          findingsUpdated++;
        } else {
          dispositionApplied = true; // falling back to insert — decision applies there
        }
      }

      // SEMANTIC cross-scan match (AI findings only): triage said this
      // prepared finding is the same real issue as existing row #same_as.
      // Update + re-parent that row (fresh title/description/severity/line)
      // instead of inserting a duplicate. Any eligibility failure falls back
      // to insert with a warning — a bad match must never lose a finding.
      const sameAs = decision?.same_as;
      if (dbId == null && sameAs != null && f.tool === 'beast') {
        const target = semanticTargets.get(sameAs);
        if (!target) {
          semanticWarnings.push({
            message: `Semantic match target #${sameAs} for finding ${f.tempId} no longer exists — inserting as new`,
            details: { tempId: f.tempId, sameAs },
          });
        } else if (target.tool !== 'beast') {
          semanticWarnings.push({
            message: `Semantic match target #${sameAs} for finding ${f.tempId} is not an AI ('beast') finding (tool='${target.tool}') — inserting as new`,
            details: { tempId: f.tempId, sameAs, targetTool: target.tool },
          });
        } else if (target.repositoryId != null && repositoryId && target.repositoryId !== repositoryId) {
          semanticWarnings.push({
            message: `Semantic match target #${sameAs} for finding ${f.tempId} belongs to another repository — inserting as new`,
            details: { tempId: f.tempId, sameAs, targetRepositoryId: target.repositoryId },
          });
        } else if (claimedSemanticTargets.has(sameAs)) {
          semanticWarnings.push({
            message: `Semantic match target #${sameAs} already matched by another finding in this scan (first wins) — inserting finding ${f.tempId} as new`,
            details: { tempId: f.tempId, sameAs },
          });
        } else {
          claimedSemanticTargets.add(sameAs);
          // AI titles/lines are rephrased/shifted every run — refresh all
          // content fields so the row reflects the newest wording/location.
          const updateSet: Record<string, unknown> = {
            testId,
            title: f.title,
            severity: f.severity,
            description: f.description ?? null,
            filePath: f.filePath ?? null,
            line: f.line ?? null,
            codeSnippet: f.codeSnippet ?? null,
            fingerprint: f.fingerprint,
            updatedAt: new Date(),
          };
          if (f.category != null) updateSet.category = f.category;
          if (f.secretValue != null) updateSet.secretValue = f.secretValue;

          if (target.status === 'open') {
            // Fresh auto-triage applies only to rows that were still open.
            updateSet.status = status;
            updateSet.riskAcceptedReason = riskAcceptedReason;
          } else {
            // Manual disposition (risk_accepted/false_positive) — PRESERVE
            // status + reason; the auto-triage decision does not apply.
            dispositionApplied = false;
          }

          const updated = await tx.update(findings)
            .set(updateSet)
            .where(eq(findings.id, sameAs))
            .returning({ id: findings.id });
          if (updated.length > 0) {
            dbId = updated[0].id;
            findingsUpdated++;
            semanticMatches++;
          } else {
            dispositionApplied = true; // falling back to insert — decision applies there
            semanticWarnings.push({
              message: `Semantic match target #${sameAs} for finding ${f.tempId} vanished during commit — inserting as new`,
              details: { tempId: f.tempId, sameAs },
            });
          }
        }
      } else if (sameAs != null && f.tool !== 'beast') {
        // Only AI findings are eligible SOURCES — enforced in code, not just
        // in the prompt. The finding proceeds through the normal flow.
        semanticWarnings.push({
          message: `Ignoring semantic match on finding ${f.tempId}: tool '${f.tool}' is not eligible (AI findings only)`,
          details: { tempId: f.tempId, sameAs, tool: f.tool },
        });
      }

      if (dbId == null) {
        const [inserted] = await tx.insert(findings).values({
          testId,
          repositoryId: repositoryId || null,
          title: f.title,
          severity: f.severity,
          description: f.description ?? null,
          filePath: f.filePath ?? null,
          line: f.line ?? null,
          vulnIdFromTool: f.vulnIdFromTool ?? null,
          cwe: f.cwe ?? null,
          cvssScore: f.cvssScore ?? null,
          tool: f.tool,
          category: f.category ?? null,
          codeSnippet: f.codeSnippet ?? null,
          secretValue: f.secretValue ?? null,
          fingerprint: f.fingerprint,
          status,
          riskAcceptedReason,
        }).returning({ id: findings.id });
        dbId = inserted.id;
        findingsNew++;
      }

      if (disposedStatus && dispositionApplied) dismissed++;
      if (!dispositionApplied) suppressedDecisionTempIds.add(f.tempId);

      // open = the committed row's final status: a suppressed decision means
      // the matched row KEPT a manual dismissal → the row is not open.
      committedFindingStats.push({
        severity: f.severity,
        open: dispositionApplied && status === 'open',
      });

      tempToDbId.set(f.tempId, dbId);
    }

    // 3. duplicate_of links — second pass, needs the full temp→db id map
    for (const d of decisions) {
      if (d.action !== 'duplicate' || d.duplicate_of == null) continue;
      const dbId = tempToDbId.get(d.finding_id);
      const targetId = tempToDbId.get(d.duplicate_of);
      if (dbId == null || targetId == null || dbId === targetId) continue;
      await tx.update(findings).set({ duplicateOf: targetId }).where(eq(findings.id, dbId));
    }

    // 4. Auto-triage notes on dismissed findings. Suppressed decisions (the
    //    matched row kept its manual disposition) must not leave notes —
    //    their triage decision was never applied.
    for (const d of decisions) {
      const label = DISPOSE_LABELS[d.action];
      if (!label) continue;
      if (suppressedDecisionTempIds.has(d.finding_id)) continue;
      const dbId = tempToDbId.get(d.finding_id);
      if (dbId == null) continue;
      await tx.insert(findingNotes).values({
        findingId: dbId,
        author: 'beast-triage',
        noteType: 'triage',
        content: `[Auto-Triage] ${label}: ${d.reason}`,
      });
    }

    // 5. Contributor attribution from triage decisions. findOrCreateContributor
    //    creates IDENTITY rows via the global db (contributors are cross-scan
    //    entities, never rolled back); the findings update joins the tx.
    for (const d of decisions) {
      if (!d.contributor_email || d.action === 'risk_accept') continue;
      if (suppressedDecisionTempIds.has(d.finding_id)) continue; // decision not applied
      const dbId = tempToDbId.get(d.finding_id);
      if (dbId == null) continue;
      try {
        const name = d.contributor_name || d.contributor_email.split('@')[0];
        const contribId = await findOrCreateContributor(d.contributor_email, name, ctx.workspaceId);
        await tx.update(findings).set({ contributorId: contribId }).where(eq(findings.id, dbId));
      } catch (err) {
        console.error(`[commit] Failed to attribute finding ${d.finding_id}:`, err instanceof Error ? err.message : err);
      }
    }
  });

  // Semantic-match fallbacks are visible in Events — a warning per problem.
  for (const w of semanticWarnings) {
    console.warn(`[commit] ${w.message}`);
    await logCommitScanEvent(ctx, 'warning', w.message, w.details);
  }

  if (wiped > 0) {
    // A previous commit attempt left rows behind (crash mid-commit) — the
    // re-run wiped and re-committed them. Scream so it's visible in Events.
    await logCommitScanEvent(ctx, 'warning',
      `Re-commit: removed ${wiped} rows from a previous commit attempt before re-committing`,
      { rowsWiped: wiped });
  }

  // 6. Contributor stats + analyzer assessments — moved here from import.
  //    Shared upsert path (also used by the HTTP ingest route): screams to
  //    scan/workspace events on failure, never throws. The returned ids feed
  //    the pipeline's feedback queueing after ALL steps succeeded.
  const assessedContributorIds = await ingestContributorStats(
    ctx, ctx.scanId, repositoryId, resultFiles, analyzerAssessments, workspaceId,
  );

  // 7. Triage assessment enhancements (appends "### Security Findings") —
  //    must run AFTER ingest so the analyzer assessments exist to append to.
  if (devAssessments.length > 0) {
    await applyAssessmentEnhancements(ctx, devAssessments);
  }

  // 8. Verified statistics: prepend a DETERMINISTIC, database-derived stats
  //    block to the AI-written Security Audit report (scan_file
  //    'final-report.md', fileType 'audit'). The triage prompt forbids the
  //    model from writing its own totals — QA caught its arithmetic being
  //    wrong — so the numbers customers see come from the committed plan.
  //    No report (triage skipped/disabled) → silent no-op. Failures scream
  //    but never fail the commit: the findings are already safely in the DB.
  try {
    const reportRows = await db.select({ content: scanFiles.content })
      .from(scanFiles)
      .where(and(
        eq(scanFiles.scanId, ctx.scanId),
        eq(scanFiles.fileName, 'final-report.md'),
        eq(scanFiles.fileType, 'audit'),
      ))
      .limit(1);
    const reportContent = reportRows[0]?.content;
    if (typeof reportContent === 'string' && reportContent.trim()) {
      const block = buildVerifiedStatsBlock({
        findings: committedFindingStats,
        testsCreated: preparedTests.length,
        findingsNew,
        findingsUpdated,
        dismissed,
        semanticMatches,
      }, ctx.reportLanguage);
      // addScanFile is upsert-by-(scanId, fileName, fileType) — writing back
      // under the same identity UPDATES the stored report in place.
      await addScanFile({
        scanId: ctx.scanId,
        fileName: 'final-report.md',
        fileType: 'audit',
        content: insertVerifiedStats(reportContent, block),
      });
    }
  } catch (err) {
    const message = `Failed to prepend verified statistics to the audit report: ${err instanceof Error ? err.message : err}`;
    console.error(`[commit] ${message}`);
    await logCommitScanEvent(ctx, 'error', message);
  }

  const output: CommitOutput = {
    testsCreated: preparedTests.length,
    findingsNew,
    findingsUpdated,
    dismissed,
    semanticMatches,
    assessedContributorIds,
  };

  await logCommitScanEvent(ctx, 'info',
    `Committed scan results: ${output.testsCreated} tests, ${findingsNew} new findings, ${findingsUpdated} updated findings, ${semanticMatches} semantically deduplicated, ${dismissed} auto-dismissed`,
    {
      testsCreated: output.testsCreated,
      findingsNew,
      findingsUpdated,
      dismissed,
      semanticMatches,
      assessedContributors: assessedContributorIds.length,
    });

  return output;
}
