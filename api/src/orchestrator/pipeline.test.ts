import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/index.ts';

const mockDb = db as any;

// ── Step function mocks ─────────────────────────────────────────

const mockRunCloneStep = vi.fn().mockResolvedValue({
  repoPath: '/workspace/repo/repo',
  cloneUrl: 'https://github.com/org/repo.git',
  branch: 'main',
  commitHash: 'abc123',
});

const mockRunAnalysisStep = vi.fn().mockResolvedValue({
  aiAvailable: true,
  profileGenerated: true,
  contributorsAssessed: 2,
  metadataPath: '/workspace/repo/agent/repo-metadata.json',
});

const mockRunSecToolsStep = vi.fn().mockResolvedValue({
  toolResults: {},
  totalDurationMs: 500,
  toolWarnings: [],
});

const mockRunAiResearchStep = vi.fn().mockResolvedValue({
  scanCompleted: true,
  skipped: false,
  durationMs: 5000,
});

const mockRunImportStep = vi.fn().mockResolvedValue({
  repositoryId: 1,
  workspaceId: 1,
  findingsPrepared: 5,
  testsPrepared: 2,
  resultFiles: [],
  preparedTests: [],
  preparedFindings: [],
  analyzerAssessments: [],
  emailAliases: {},
});

const mockRunTriageStep = vi.fn().mockResolvedValue({
  triaged: 3,
  dismissed: 1,
  kept: 2,
  reportsGenerated: true,
  assessmentsEnhanced: 1,
  durationMs: 8000,
  decisions: [],
  devAssessments: [],
});

const mockRunMitigationCheckStep = vi.fn().mockResolvedValue({
  candidates: 0,
  confirmedFixed: 0,
  stillPresent: 0,
  unverifiable: 0,
  durationMs: 0,
  mitigationDecisions: [],
});

const mockRunCommitStep = vi.fn().mockResolvedValue({
  testsCreated: 2,
  findingsNew: 4,
  findingsUpdated: 1,
  dismissed: 1,
  assessedContributorIds: [],
});

vi.mock('./steps/clone.ts', () => ({
  runCloneStep: (...args: unknown[]) => mockRunCloneStep(...args),
}));

vi.mock('./steps/analyzer.ts', () => ({
  runAnalysisStep: (...args: unknown[]) => mockRunAnalysisStep(...args),
}));

vi.mock('./steps/security-tools.ts', () => ({
  runSecToolsStep: (...args: unknown[]) => mockRunSecToolsStep(...args),
}));

vi.mock('./steps/scanner.ts', () => ({
  runAiResearchStep: (...args: unknown[]) => mockRunAiResearchStep(...args),
}));

vi.mock('./steps/import-results.ts', () => ({
  runImportStep: (...args: unknown[]) => mockRunImportStep(...args),
}));

vi.mock('./steps/triage-report.ts', () => ({
  runTriageStep: (...args: unknown[]) => mockRunTriageStep(...args),
}));

vi.mock('./steps/mitigation-check.ts', () => ({
  runMitigationCheckStep: (...args: unknown[]) => mockRunMitigationCheckStep(...args),
}));

vi.mock('./steps/commit-results.ts', () => ({
  runCommitStep: (...args: unknown[]) => mockRunCommitStep(...args),
}));

// ── ai-trace mock (clearTraces at pipeline start) ────────────────

const mockClearTraces = vi.fn().mockResolvedValue(undefined);

vi.mock('./ai-trace.ts', () => ({
  clearTraces: (...args: unknown[]) => mockClearTraces(...args),
}));

// ── feedback-worker mock (queued only after a fully successful scan) ──

const mockQueueFeedbackCompilation = vi.fn();

vi.mock('./feedback-worker.ts', () => ({
  queueFeedbackCompilation: (...args: unknown[]) => mockQueueFeedbackCompilation(...args),
}));

// ── DB mock ─────────────────────────────────────────────────────

let insertCallCount = 0;

function resetDbMock() {
  insertCallCount = 0;
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
  mockDb.insert.mockReturnValue(mockDb);
  mockDb.values.mockReturnValue(mockDb);
  mockDb.returning.mockImplementation(() => {
    insertCallCount++;
    return Promise.resolve([{ id: insertCallCount }]);
  });
  mockDb.set.mockReturnValue(mockDb);
  // checkCancelled: scan is running (not cancelled)
  mockDb.where.mockResolvedValue([{ status: 'running' }]);
  mockDb.update.mockReturnValue(mockDb);
  mockDb.select.mockReturnValue(mockDb);
  mockDb.from.mockReturnValue(mockDb);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMock();
});

// ── Helpers ──────────────────────────────────────────────────────

function makeScan(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'scan-1',
    status: 'queued',
    repoUrl: 'https://github.com/org/my-repo.git',
    repoName: 'my-repo',
    branch: 'main',
    commitHash: 'abc123',
    localPath: null,
    error: null,
    durationMs: null,
    metadata: {},
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    repositoryId: null,
    workspaceId: null,
    scanType: 'full',
    ...overrides,
  };
}

// ── Module exports ──────────────────────────────────────────────

describe('pipeline module exports', () => {
  it('exports runPipeline function', async () => {
    const mod = await import('./pipeline.ts');
    expect(typeof mod.runPipeline).toBe('function');
  });

  it('exports buildContext helper', async () => {
    const mod = await import('./pipeline.ts');
    expect(typeof mod.buildContext).toBe('function');
  });
});

// ── runPipeline ─────────────────────────────────────────────────

describe('runPipeline', () => {
  it('inserts step rows at start', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    // 8 step rows created (clone, analysis, security-tools, ai-research, import, triage-report, mitigation-check, commit)
    expect(mockDb.insert).toHaveBeenCalled();
    // returning() called 8 times for step rows + values() calls for events
    expect(insertCallCount).toBeGreaterThanOrEqual(8);
  });

  it('calls all step functions in order', async () => {
    const { runPipeline } = await import('./pipeline.ts');
    const callOrder: string[] = [];

    mockRunCloneStep.mockImplementation(async () => {
      callOrder.push('clone');
      return { repoPath: '/repo', cloneUrl: '', branch: '', commitHash: '' };
    });
    mockRunAnalysisStep.mockImplementation(async () => {
      callOrder.push('analysis');
      return { aiAvailable: true, profileGenerated: true, contributorsAssessed: 0, metadataPath: '' };
    });
    mockRunSecToolsStep.mockImplementation(async () => {
      callOrder.push('security-tools');
      return { toolResults: {}, totalDurationMs: 0, toolWarnings: [] };
    });
    mockRunAiResearchStep.mockImplementation(async () => {
      callOrder.push('ai-research');
      return { scanCompleted: true, skipped: false, durationMs: 0 };
    });
    mockRunImportStep.mockImplementation(async () => {
      callOrder.push('import');
      return { repositoryId: 1, workspaceId: 1, findingsPrepared: 0, testsPrepared: 0, resultFiles: [], preparedTests: [], preparedFindings: [], analyzerAssessments: [], emailAliases: {} };
    });
    mockRunTriageStep.mockImplementation(async () => {
      callOrder.push('triage');
      return { triaged: 0, dismissed: 0, kept: 0, reportsGenerated: false, assessmentsEnhanced: 0, durationMs: 0, decisions: [], devAssessments: [] };
    });
    mockRunMitigationCheckStep.mockImplementation(async () => {
      callOrder.push('mitigation');
      return { candidates: 0, confirmedFixed: 0, stillPresent: 0, unverifiable: 0, durationMs: 0, mitigationDecisions: [] };
    });
    mockRunCommitStep.mockImplementation(async () => {
      callOrder.push('commit');
      return { testsCreated: 0, findingsNew: 0, findingsUpdated: 0, dismissed: 0, assessedContributorIds: [] };
    });

    await runPipeline(makeScan());

    // clone and analysis are sequential, then security-tools + ai-research parallel,
    // then import, then triage, then mitigation-check, then commit LAST (repo
    // data lands only there)
    expect(callOrder.indexOf('clone')).toBeLessThan(callOrder.indexOf('analysis'));
    expect(callOrder.indexOf('analysis')).toBeLessThan(callOrder.indexOf('import'));
    expect(callOrder.indexOf('import')).toBeLessThan(callOrder.indexOf('triage'));
    expect(callOrder.indexOf('triage')).toBeLessThan(callOrder.indexOf('mitigation'));
    expect(callOrder.indexOf('mitigation')).toBeLessThan(callOrder.indexOf('commit'));
    expect(callOrder[callOrder.length - 1]).toBe('commit');
    // security-tools and ai-research both come after analysis
    expect(callOrder.indexOf('analysis')).toBeLessThan(callOrder.indexOf('security-tools'));
    expect(callOrder.indexOf('analysis')).toBeLessThan(callOrder.indexOf('ai-research'));
  });

  it('calls clone step', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    expect(mockRunCloneStep).toHaveBeenCalledTimes(1);
  });

  it('calls analysis step', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    expect(mockRunAnalysisStep).toHaveBeenCalledTimes(1);
  });

  it('calls security-tools and ai-research steps', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    expect(mockRunSecToolsStep).toHaveBeenCalledTimes(1);
    expect(mockRunAiResearchStep).toHaveBeenCalledTimes(1);
  });

  it('calls import step', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    expect(mockRunImportStep).toHaveBeenCalledTimes(1);
  });

  it('calls triage step', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    expect(mockRunTriageStep).toHaveBeenCalledTimes(1);
  });

  it('calls mitigation-check step', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    expect(mockRunMitigationCheckStep).toHaveBeenCalledTimes(1);
  });

  it('calls commit step', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    expect(mockRunCommitStep).toHaveBeenCalledTimes(1);
  });

  it('fails the scan when the commit step throws (always required)', async () => {
    // commit is required:true — repo data landing is not optional. A commit
    // failure fails the scan; the worker's cleanup then removes whatever a
    // partial commit wrote (the tx normally rolled it back already).
    const { runPipeline } = await import('./pipeline.ts');

    mockRunCommitStep.mockRejectedValueOnce(new Error('commit tx failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('commit tx failed');
    expect(mockQueueFeedbackCompilation).not.toHaveBeenCalled();
  });

  it('rethrows on clone error', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunCloneStep.mockRejectedValueOnce(new Error('clone failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('clone failed');
  });

  it('rethrows on import error', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunImportStep.mockRejectedValueOnce(new Error('import failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('import failed');
  });

  it('fails the scan when the analysis step throws and AI analysis is enabled (default)', async () => {
    // makeScan has workspaceId:null → AI toggles default to true, so analysis is
    // required: a step that was supposed to run and didn't must fail the whole
    // scan, never silently degrade.
    const { runPipeline } = await import('./pipeline.ts');

    mockRunAnalysisStep.mockRejectedValueOnce(new Error('analyzer down'));

    await expect(runPipeline(makeScan())).rejects.toThrow('analyzer down');
    expect(mockRunImportStep).not.toHaveBeenCalled();
  });

  it('fails the scan when the security-tools step throws (always required)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunSecToolsStep.mockRejectedValueOnce(new Error('All configured authentication methods failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('All configured authentication methods failed');
    expect(mockRunImportStep).not.toHaveBeenCalled();
  });

  it('fails the scan when the ai-research step throws and AI scanning is enabled (default)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunAiResearchStep.mockRejectedValueOnce(new Error('scanner down'));

    await expect(runPipeline(makeScan())).rejects.toThrow('scanner down');
    expect(mockRunImportStep).not.toHaveBeenCalled();
  });

  it('fails the scan when the triage step throws and AI triage is enabled (default)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunTriageStep.mockRejectedValueOnce(new Error('triage failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('triage failed');
  });

  it('fails the scan when the mitigation-check step throws and AI triage is enabled (default)', async () => {
    // mitigation-check shares the triage capability toggle — when triage is
    // supposed to run, verified auto-closing is too; a silent skip would leave
    // fixed findings stuck open with no signal.
    const { runPipeline } = await import('./pipeline.ts');

    mockRunMitigationCheckStep.mockRejectedValueOnce(new Error('mitigation agent failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('mitigation agent failed');
    expect(mockRunCommitStep).not.toHaveBeenCalled();
  });

  // Developer profiles update only as a result of a FULLY successful scan —
  // a failed scan must not leave partial side effects. The assessed ids now
  // come from the COMMIT step (assessments land in the DB only there).
  it('queues feedback compilation from the commit output after every step succeeded', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunCommitStep.mockResolvedValueOnce({
      testsCreated: 0, findingsNew: 0, findingsUpdated: 0, dismissed: 0,
      assessedContributorIds: [100, 200, 100],
    });

    await runPipeline(makeScan());

    expect(mockQueueFeedbackCompilation).toHaveBeenCalledTimes(2); // deduped
    expect(mockQueueFeedbackCompilation).toHaveBeenCalledWith(100);
    expect(mockQueueFeedbackCompilation).toHaveBeenCalledWith(200);
  });

  it('does NOT queue feedback compilation when a later step fails the scan', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunTriageStep.mockRejectedValueOnce(new Error('triage failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('triage failed');
    // Commit never ran, so no assessments landed and nothing is queued
    expect(mockRunCommitStep).not.toHaveBeenCalled();
    expect(mockQueueFeedbackCompilation).not.toHaveBeenCalled();
  });

  it('fails the scan when a required step (clone) throws', async () => {
    // clone is required:true — its failure is fatal and must propagate so the
    // worker marks the scan failed. Subsequent steps must not run.
    const { runPipeline } = await import('./pipeline.ts');

    mockRunCloneStep.mockRejectedValueOnce(new Error('clone failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('clone failed');
    expect(mockRunImportStep).not.toHaveBeenCalled();
  });

  it('accumulates step outputs and passes to subsequent steps', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunCloneStep.mockResolvedValueOnce({ repoPath: '/repo', cloneUrl: 'url', branch: 'main', commitHash: 'abc' });
    mockRunAnalysisStep.mockResolvedValueOnce({ aiAvailable: true, profileGenerated: true, contributorsAssessed: 1, metadataPath: '/meta' });

    await runPipeline(makeScan());

    // Import step should receive accumulated output from clone + analysis + parallel steps
    const importCall = mockRunImportStep.mock.calls[0][0];
    expect(importCall.prev).toHaveProperty('repoPath', '/repo');
    expect(importCall.prev).toHaveProperty('aiAvailable', true);
  });

  it('passes ctx to each step', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    const cloneCall = mockRunCloneStep.mock.calls[0][0];
    expect(cloneCall.ctx).toHaveProperty('scanId', 'scan-1');
    expect(cloneCall.ctx).toHaveProperty('repoName', 'my-repo');
  });

  it('updates step statuses via db.update', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    // Pipeline calls updateStepStatus multiple times (running -> completed for each step)
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('saves step input and output to scan_steps', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunCloneStep.mockResolvedValueOnce({ repoPath: '/repo', myKey: 'myValue' });

    await runPipeline(makeScan());

    // updateStepStatus is called with output containing the step's return value
    const setCalls = mockDb.set.mock.calls;
    // At least one set() call should contain output with step data
    const hasOutput = setCalls.some((call: any[]) => call[0]?.output !== undefined);
    expect(hasOutput).toBe(true);
  });

  it('checks for cancellation between steps', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    // Make checkCancelled return true after clone
    let callCount = 0;
    mockDb.where.mockImplementation(() => {
      callCount++;
      // First few calls are for step inserts/updates, later ones are checkCancelled
      // checkCancelled calls db.select().from(scans).where() — we detect by returning failed status
      if (callCount > 8) return Promise.resolve([{ status: 'failed' }]);
      return Promise.resolve([{ status: 'running', id: callCount }]);
    });

    await expect(runPipeline(makeScan())).rejects.toThrow('Scan cancelled by user');
  });

  it('handles local path scan context', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan({ repoUrl: null, localPath: '/tmp/projects/my-repo' }));

    const ctx = mockRunCloneStep.mock.calls[0][0].ctx;
    expect(ctx.localPath).toBe('/tmp/projects/my-repo');
    expect(ctx.cloneUrl).toBe('');
  });

  it('sets reportLanguage on context from workspace default_language', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockDb.where.mockImplementation(() => {
      return Promise.resolve([{ status: 'running', defaultLanguage: 'uk', aiAnalysisEnabled: true, aiScanningEnabled: true, aiTriageEnabled: true, aiModelAnalyzer: 'sonnet', aiModelScanner: 'opus', aiModelTriage: 'opus' }]);
    });

    await runPipeline(makeScan({ workspaceId: 5 }));

    const ctx = mockRunCloneStep.mock.calls[0][0].ctx;
    expect(ctx.reportLanguage).toBeDefined();
  });

  it('logs scan started and completed events', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    await runPipeline(makeScan());

    // logScanEvent calls db.insert(scanEvents).values(...)
    // "Scan started" and "Scan completed" events
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalled();
  });

  it('parallel group: a required step failure lets the sibling finish but fails the scan', async () => {
    // security-tools is required:true. allSettled lets the parallel sibling
    // (ai-research) run to completion, but the required rejection must still
    // abort the scan before import.
    const { runPipeline } = await import('./pipeline.ts');

    mockRunSecToolsStep.mockRejectedValueOnce(new Error('sec-tools error'));

    await expect(runPipeline(makeScan())).rejects.toThrow('sec-tools error');
    // ai-research was started in parallel and runs to completion (allSettled)
    expect(mockRunAiResearchStep).toHaveBeenCalledTimes(1);
    // The scan must NOT proceed to import after a required-step failure
    expect(mockRunImportStep).not.toHaveBeenCalled();
  });

  // ── Feature toggle off → step failure is non-fatal ────────────
  // When a workspace disables an AI feature, its step is not required: even if
  // the step throws, the scan completes (nothing it was "supposed to run" was
  // lost). The workspace select in buildContext, checkCancelled reads and the
  // existing-steps select all consume mockDb.where, so return one combined row
  // that satisfies every query (same approach as the reportLanguage test).
  function mockWorkspaceToggles(overrides: Record<string, unknown> = {}) {
    mockDb.where.mockImplementation(() => Promise.resolve([{
      status: 'running',
      defaultLanguage: 'en',
      aiAnalysisEnabled: true,
      aiScanningEnabled: true,
      aiTriageEnabled: true,
      aiModelAnalyzer: 'sonnet',
      aiModelScanner: 'opus',
      aiModelTriage: 'opus',
      scanDepth: 500,
      ...overrides,
    }]));
  }

  it('continues the scan when analysis throws but AI analysis is disabled for the workspace', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockWorkspaceToggles({ aiAnalysisEnabled: false });
    mockRunAnalysisStep.mockRejectedValueOnce(new Error('analyzer down'));

    // repositoryId stays null (makeScan default) so buildContext skips the
    // repositories.sourceId lookup and the first where() is the workspace select.
    await expect(runPipeline(makeScan({ workspaceId: 5 }))).resolves.toEqual({ completedWithErrors: false, stepErrors: [] });
    expect(mockRunImportStep).toHaveBeenCalled();
  });

  it('continues the scan when ai-research throws but AI scanning is disabled for the workspace', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockWorkspaceToggles({ aiScanningEnabled: false });
    mockRunAiResearchStep.mockRejectedValueOnce(new Error('scanner down'));

    await expect(runPipeline(makeScan({ workspaceId: 5 }))).resolves.toEqual({ completedWithErrors: false, stepErrors: [] });
    // Parallel sibling still ran, and the scan proceeded to import
    expect(mockRunSecToolsStep).toHaveBeenCalledTimes(1);
    expect(mockRunImportStep).toHaveBeenCalled();
  });

  it('continues the scan when triage throws but AI triage is disabled for the workspace', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockWorkspaceToggles({ aiTriageEnabled: false });
    mockRunTriageStep.mockRejectedValueOnce(new Error('triage failed'));

    await expect(runPipeline(makeScan({ workspaceId: 5 }))).resolves.toEqual({ completedWithErrors: false, stepErrors: [] });
    expect(mockRunImportStep).toHaveBeenCalled();
  });

  it('continues the scan when mitigation-check throws but AI triage is disabled for the workspace', async () => {
    // mitigation-check is gated by the SAME workspace toggle as triage
    const { runPipeline } = await import('./pipeline.ts');

    mockWorkspaceToggles({ aiTriageEnabled: false });
    mockRunMitigationCheckStep.mockRejectedValueOnce(new Error('mitigation agent failed'));

    await expect(runPipeline(makeScan({ workspaceId: 5 }))).resolves.toEqual({ completedWithErrors: false, stepErrors: [] });
    expect(mockRunCommitStep).toHaveBeenCalled();
  });

  // ── Resume / pause behavior ──────────────────────────────────

  it('skips steps already marked completed (resume scenario)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    // Simulate existing completed steps for clone + analysis (resume)
    // Pipeline first does: select existingSteps -> mockDb.where (return completed steps)
    // Then for each completed step: select output -> also via mockDb.where
    // checkCancelled also reads via mockDb.where; we need a flexible mock.
    let callCount = 0;
    mockDb.where.mockImplementation(() => {
      callCount++;
      // First call: existingSteps select (return all 6 steps with clone+analysis completed)
      if (callCount === 1) {
        return Promise.resolve([
          { id: 1, scanId: 'scan-1', stepName: 'clone', stepOrder: 1, status: 'completed', output: { repoPath: '/repo', cloneUrl: '', branch: '', commitHash: '' } },
          { id: 2, scanId: 'scan-1', stepName: 'analysis', stepOrder: 2, status: 'completed', output: { aiAvailable: true, profileGenerated: true, contributorsAssessed: 0, metadataPath: '' } },
          { id: 3, scanId: 'scan-1', stepName: 'security-tools', stepOrder: 3, status: 'pending' },
          { id: 4, scanId: 'scan-1', stepName: 'ai-research', stepOrder: 4, status: 'pending' },
          { id: 5, scanId: 'scan-1', stepName: 'import', stepOrder: 5, status: 'pending' },
          { id: 6, scanId: 'scan-1', stepName: 'triage-report', stepOrder: 6, status: 'pending' },
          { id: 7, scanId: 'scan-1', stepName: 'commit', stepOrder: 7, status: 'pending' },
        ]);
      }
      // Other reads (checkCancelled, loadOutput, etc) — pretend running
      return Promise.resolve([{ status: 'running' }]);
    });

    await runPipeline(makeScan());

    // clone + analysis must NOT have been re-executed
    expect(mockRunCloneStep).not.toHaveBeenCalled();
    expect(mockRunAnalysisStep).not.toHaveBeenCalled();

    // pending steps must run
    expect(mockRunSecToolsStep).toHaveBeenCalledTimes(1);
    expect(mockRunAiResearchStep).toHaveBeenCalledTimes(1);
    expect(mockRunImportStep).toHaveBeenCalledTimes(1);
    expect(mockRunCommitStep).toHaveBeenCalledTimes(1);
  });

  it('resume after triage: import + triage plans reload from step outputs and only commit runs', async () => {
    // Pause during/after triage: the prepared plan (import output) and the
    // decisions (triage output) live in scan_steps.output — the resumed run
    // must hand them to the commit step without re-running import/triage.
    const { runPipeline } = await import('./pipeline.ts');

    const importOutput = {
      repositoryId: 1, workspaceId: 1, findingsPrepared: 1, testsPrepared: 1,
      resultFiles: [],
      preparedTests: [{ key: 'gitleaks', tool: 'gitleaks', scanType: 'Gitleaks Scan', fileName: 'gitleaks-results.json', findingsCount: 1 }],
      preparedFindings: [{ tempId: 0, testKey: 'gitleaks', title: 'S', severity: 'High', tool: 'gitleaks', fingerprint: 'fp-0' }],
      analyzerAssessments: [], emailAliases: {},
    };
    const triageOutput = {
      triaged: 1, dismissed: 1, kept: 0, reportsGenerated: true, assessmentsEnhanced: 0, durationMs: 5,
      decisions: [{ finding_id: 0, action: 'false_positive', reason: 'fp' }],
      devAssessments: [],
    };

    // loadOutput uses select().from().where() with a step id — emulate outputs
    // per step by keying off the hydration order: hydration happens
    // sequentially (clone..triage), each via one where() call.
    let callCount = 0;
    let hydrateCall = 0;
    const outputs: Record<number, unknown> = {
      1: { output: { repoPath: '/repo' } },
      2: { output: { aiAvailable: true } },
      3: { output: { toolResults: {} } },
      4: { output: { scanCompleted: true } },
      5: { output: importOutput },
      6: { output: triageOutput },
    };
    mockDb.where.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([
          { id: 1, scanId: 'scan-1', stepName: 'clone', stepOrder: 1, status: 'completed', output: { repoPath: '/repo' } },
          { id: 2, scanId: 'scan-1', stepName: 'analysis', stepOrder: 2, status: 'completed', output: { aiAvailable: true } },
          { id: 3, scanId: 'scan-1', stepName: 'security-tools', stepOrder: 3, status: 'completed', output: { toolResults: {} } },
          { id: 4, scanId: 'scan-1', stepName: 'ai-research', stepOrder: 4, status: 'completed', output: { scanCompleted: true } },
          { id: 5, scanId: 'scan-1', stepName: 'import', stepOrder: 5, status: 'completed', output: importOutput },
          { id: 6, scanId: 'scan-1', stepName: 'triage-report', stepOrder: 6, status: 'completed', output: triageOutput },
          { id: 7, scanId: 'scan-1', stepName: 'commit', stepOrder: 7, status: 'pending' },
        ]);
      }
      // Hydration loadOutput calls come right after the existing-steps select,
      // one per completed step in order (clone, analysis, sec-tools, ai-research, import, triage).
      if (hydrateCall < 6) {
        hydrateCall++;
        return Promise.resolve([outputs[hydrateCall]]);
      }
      return Promise.resolve([{ status: 'running' }]);
    });

    await runPipeline(makeScan());

    // Only commit ran — with the reloaded plan + decisions in prev
    expect(mockRunImportStep).not.toHaveBeenCalled();
    expect(mockRunTriageStep).not.toHaveBeenCalled();
    expect(mockRunCommitStep).toHaveBeenCalledTimes(1);
    const commitPrev = mockRunCommitStep.mock.calls[0][0].prev;
    expect(commitPrev.preparedFindings).toEqual(importOutput.preparedFindings);
    expect(commitPrev.decisions).toEqual(triageOutput.decisions);
  });

  it('clears stale AI traces at the start of a FRESH run', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    // Fresh run: the initial scan_steps select finds NO existing rows.
    let callCount = 0;
    mockDb.where.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([]);
      return Promise.resolve([{ status: 'running' }]);
    });

    await runPipeline(makeScan());

    expect(mockClearTraces).toHaveBeenCalledTimes(1);
    expect(mockClearTraces).toHaveBeenCalledWith('scan-1');
  });

  it('does NOT clear AI traces on a resumed run (would lose completed-wave traces)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    // Simulate a resume: existing step rows are found for this scan.
    let callCount = 0;
    mockDb.where.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([
          { id: 1, scanId: 'scan-1', stepName: 'clone', stepOrder: 1, status: 'completed', output: { repoPath: '/repo' } },
          { id: 2, scanId: 'scan-1', stepName: 'analysis', stepOrder: 2, status: 'pending' },
          { id: 3, scanId: 'scan-1', stepName: 'security-tools', stepOrder: 3, status: 'pending' },
          { id: 4, scanId: 'scan-1', stepName: 'ai-research', stepOrder: 4, status: 'pending' },
          { id: 5, scanId: 'scan-1', stepName: 'import', stepOrder: 5, status: 'pending' },
          { id: 6, scanId: 'scan-1', stepName: 'triage-report', stepOrder: 6, status: 'pending' },
          { id: 7, scanId: 'scan-1', stepName: 'commit', stepOrder: 7, status: 'pending' },
        ]);
      }
      return Promise.resolve([{ status: 'running' }]);
    });

    await runPipeline(makeScan());

    expect(mockClearTraces).not.toHaveBeenCalled();
  });

  it('rethrows ScanPausedError without marking step failed', async () => {
    const { runPipeline } = await import('./pipeline.ts');
    const { ScanPausedError } = await import('./rate-limit.ts');

    mockRunAiResearchStep.mockRejectedValueOnce(new ScanPausedError('Claude rate limit', '2026-05-04T20:00:00Z'));

    await expect(runPipeline(makeScan())).rejects.toBeInstanceOf(ScanPausedError);

    // import + triage must NOT run because pipeline aborts on paused error
    expect(mockRunImportStep).not.toHaveBeenCalled();
    expect(mockRunTriageStep).not.toHaveBeenCalled();
  });
});

// ── buildContext ─────────────────────────────────────────────────

describe('buildContext', () => {
  it('builds context from scan with repoUrl', async () => {
    const { buildContext } = await import('./pipeline.ts');

    const ctx = await buildContext(makeScan());

    expect(ctx.scanId).toBe('scan-1');
    expect(ctx.repoName).toBe('my-repo');
    expect(ctx.repoUrl).toBe('https://github.com/org/my-repo.git');
    expect(ctx.cloneUrl).toBe('https://github.com/org/my-repo.git');
    // repositoryId is null → falls back to the repo-id key (repo-0)
    expect(ctx.repoBaseDir).toBe('/workspace/repo-0/my-repo');
    expect(ctx.repoPath).toBe('/workspace/repo-0/my-repo/repo');
    expect(ctx.reportLanguage).toBe('en');
  });

  // Same-named repos from different sources must never share a clone dir —
  // paths are keyed by SOURCE id (globally unique), not by repo name.
  it('keys all repo paths by source id', async () => {
    const { buildContext } = await import('./pipeline.ts');

    mockDb.where.mockResolvedValueOnce([{ sourceId: 7 }]);

    const ctx = await buildContext(makeScan({ repositoryId: 10 }));

    expect(ctx.repoBaseDir).toBe('/workspace/src-7/my-repo');
    expect(ctx.repoPath).toBe('/workspace/src-7/my-repo/repo');
    expect(ctx.workDir).toBe('/workspace/src-7/my-repo/scan-1');
    expect(ctx.profilePath).toBe('/workspace/src-7/my-repo/repo-profile.md');
    expect(ctx.scanContextPath).toBe('/workspace/src-7/my-repo/scan-context.md');
  });

  it('same repo name under two different sources yields two different paths', async () => {
    const { buildContext } = await import('./pipeline.ts');

    mockDb.where.mockResolvedValueOnce([{ sourceId: 1 }]);
    const github = await buildContext(makeScan({ repositoryId: 10, repoName: 'mountain' }));
    mockDb.where.mockResolvedValueOnce([{ sourceId: 2 }]);
    const gitlab = await buildContext(makeScan({ repositoryId: 11, repoName: 'mountain' }));

    expect(github.repoPath).toBe('/workspace/src-1/mountain/repo');
    expect(gitlab.repoPath).toBe('/workspace/src-2/mountain/repo');
    expect(github.repoPath).not.toBe(gitlab.repoPath);
  });

  it('falls back to the repository id when the repo has no source', async () => {
    const { buildContext } = await import('./pipeline.ts');

    mockDb.where.mockResolvedValueOnce([{ sourceId: null }]);

    const ctx = await buildContext(makeScan({ repositoryId: 10 }));

    expect(ctx.repoBaseDir).toBe('/workspace/repo-10/my-repo');
    expect(ctx.repoPath).toBe('/workspace/repo-10/my-repo/repo');
  });

  it('builds context from scan with absolute localPath', async () => {
    const { buildContext } = await import('./pipeline.ts');

    const ctx = await buildContext(makeScan({ repoUrl: null, localPath: '/workspace/uploads/abc/extracted/my-repo' }));

    expect(ctx.localPath).toBe('/workspace/uploads/abc/extracted/my-repo');
    expect(ctx.cloneUrl).toBe('');
    expect(ctx.repoPath).toBe('/workspace/uploads/abc/extracted/my-repo');
  });

  it('builds context from scan with relative localPath', async () => {
    const { buildContext } = await import('./pipeline.ts');

    const ctx = await buildContext(makeScan({ repoUrl: null, localPath: 'projects/my-repo' }));

    expect(ctx.localPath).toBe('projects/my-repo');
    expect(ctx.cloneUrl).toBe('');
    expect(ctx.repoPath).toBe('/local-repos/projects/my-repo');
  });

  it('resolves workspace language', async () => {
    const { buildContext } = await import('./pipeline.ts');

    mockDb.where.mockResolvedValueOnce([{ defaultLanguage: 'uk', aiAnalysisEnabled: true, aiScanningEnabled: true, aiTriageEnabled: true, aiModelAnalyzer: 'sonnet', aiModelScanner: 'opus', aiModelTriage: 'opus' }]);

    const ctx = await buildContext(makeScan({ workspaceId: 5 }));

    expect(ctx.reportLanguage).toBe('uk');
  });

  it('reads AI feature flags from workspace', async () => {
    const { buildContext } = await import('./pipeline.ts');

    mockDb.where.mockResolvedValueOnce([{
      defaultLanguage: 'en',
      aiAnalysisEnabled: false,
      aiScanningEnabled: false,
      aiTriageEnabled: true,
      aiModelAnalyzer: 'sonnet',
      aiModelScanner: 'opus',
      aiModelTriage: 'opus',
    }]);

    const ctx = await buildContext(makeScan({ workspaceId: 5 }));

    expect(ctx.aiAnalysisEnabled).toBe(false);
    expect(ctx.aiScanningEnabled).toBe(false);
    expect(ctx.aiTriageEnabled).toBe(true);
    expect(ctx.aiModelAnalyzer).toBe('sonnet');
    expect(ctx.aiModelScanner).toBe('opus');
    expect(ctx.aiModelTriage).toBe('opus');
  });

  it('carries the scan type into the context (mitigation-check skips PR scans)', async () => {
    const { buildContext } = await import('./pipeline.ts');

    const full = await buildContext(makeScan());
    const pr = await buildContext(makeScan({ scanType: 'pr' }));
    const legacy = await buildContext(makeScan({ scanType: null }));

    expect(full.scanType).toBe('full');
    expect(pr.scanType).toBe('pr');
    expect(legacy.scanType).toBe('full');
  });

  it('defaults AI flags to true when no workspace', async () => {
    const { buildContext } = await import('./pipeline.ts');

    const ctx = await buildContext(makeScan({ workspaceId: null }));

    expect(ctx.aiAnalysisEnabled).toBe(true);
    expect(ctx.aiScanningEnabled).toBe(true);
    expect(ctx.aiTriageEnabled).toBe(true);
    expect(ctx.aiModelAnalyzer).toBe('sonnet');
    expect(ctx.aiModelScanner).toBe('opus');
    expect(ctx.aiModelTriage).toBe('opus');
  });
});

// ── "Completed with errors" collection ───────────────────────────

describe('runPipeline — completed with errors', () => {
  it('returns completedWithErrors=false and no stepErrors on a clean run', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    const result = await runPipeline(makeScan());

    expect(result).toEqual({ completedWithErrors: false, stepErrors: [] });

    // Final event is the plain info "Scan completed" one
    const eventMessages = mockDb.values.mock.calls
      .map((c: any[]) => c[0]?.message)
      .filter(Boolean);
    expect(eventMessages.some((m: string) => m.includes('Scan completed for'))).toBe(true);
    expect(eventMessages.some((m: string) => m.includes('completed with errors'))).toBe(false);
  });

  it('collects toolErrors + moduleErrors from step outputs and logs ONE detailed warning event', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunSecToolsStep.mockResolvedValueOnce({
      toolResults: { semgrep: { status: 'failed', durationMs: 5, findingsCount: 0, error: 'network timeout' } },
      totalDurationMs: 500,
      toolWarnings: [],
      toolErrors: [
        { kind: 'tool', name: 'semgrep', error: 'failed after retry: network timeout', failedAfterRetry: true },
      ],
    });
    mockRunAiResearchStep.mockResolvedValueOnce({
      scanCompleted: true,
      skipped: false,
      durationMs: 5000,
      moduleErrors: [
        { kind: 'module', name: 'src/api', error: 'failed after retry — attempt 1: context overflow; attempt 2: context overflow', failedAfterRetry: true },
      ],
    });

    const result = await runPipeline(makeScan());

    expect(result.completedWithErrors).toBe(true);
    expect(result.stepErrors).toHaveLength(2);
    expect(result.stepErrors.map(e => e.name)).toEqual(['semgrep', 'src/api']);

    // Commit still ran — succeeded tools/modules ARE committed, that's the point
    expect(mockRunCommitStep).toHaveBeenCalledTimes(1);

    // One completion warning event listing every surviving error
    const warningEvents = mockDb.values.mock.calls
      .map((c: any[]) => c[0])
      .filter((v: any) => v?.level === 'warning' && String(v?.message).startsWith('Scan completed with errors:'));
    expect(warningEvents).toHaveLength(1);
    expect(warningEvents[0].message).toContain('semgrep (failed after retry: network timeout)');
    expect(warningEvents[0].message).toContain('module src/api');
    expect(warningEvents[0].details.stepErrors).toHaveLength(2);
  });

  it('tool errors alone flag the scan (no module errors involved)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunSecToolsStep.mockResolvedValueOnce({
      toolResults: {},
      totalDurationMs: 1,
      toolWarnings: [],
      toolErrors: [{ kind: 'tool', name: 'gitleaks', error: 'oom', failedAfterRetry: true }],
    });

    const result = await runPipeline(makeScan());
    expect(result.completedWithErrors).toBe(true);
    expect(result.stepErrors).toEqual([
      { kind: 'tool', name: 'gitleaks', error: 'oom', failedAfterRetry: true },
    ]);
  });
});
