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
  findingsImported: 5,
  testsCreated: 2,
  resultFiles: [],
  findingsPerContributor: {},
});

const mockRunTriageStep = vi.fn().mockResolvedValue({
  triaged: 3,
  dismissed: 1,
  kept: 2,
  reportsGenerated: true,
  assessmentsEnhanced: 1,
  durationMs: 8000,
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
    pullRequestId: null,
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

  it('exports logScanEvent helper', async () => {
    const mod = await import('./pipeline.ts');
    expect(typeof mod.logScanEvent).toBe('function');
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

    // 6 step rows created (clone, analysis, security-tools, ai-research, import, triage-report)
    expect(mockDb.insert).toHaveBeenCalled();
    // returning() called 6 times for step rows + values() calls for events
    expect(insertCallCount).toBeGreaterThanOrEqual(6);
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
      return { repositoryId: 1, workspaceId: 1, findingsImported: 0, testsCreated: 0, resultFiles: [], findingsPerContributor: {} };
    });
    mockRunTriageStep.mockImplementation(async () => {
      callOrder.push('triage');
      return { triaged: 0, dismissed: 0, kept: 0, reportsGenerated: false, assessmentsEnhanced: 0, durationMs: 0 };
    });

    await runPipeline(makeScan());

    // clone and analysis are sequential, then security-tools + ai-research parallel, then import, then triage
    expect(callOrder.indexOf('clone')).toBeLessThan(callOrder.indexOf('analysis'));
    expect(callOrder.indexOf('analysis')).toBeLessThan(callOrder.indexOf('import'));
    expect(callOrder.indexOf('import')).toBeLessThan(callOrder.indexOf('triage'));
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

  it('rethrows on clone error (required step)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunCloneStep.mockRejectedValueOnce(new Error('clone failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('clone failed');
  });

  it('rethrows on import error (required step)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunImportStep.mockRejectedValueOnce(new Error('import failed'));

    await expect(runPipeline(makeScan())).rejects.toThrow('import failed');
  });

  it('continues when optional analysis step fails', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunAnalysisStep.mockRejectedValueOnce(new Error('analyzer down'));

    // Should not throw — analysis is optional
    await runPipeline(makeScan());

    // Subsequent steps still called
    expect(mockRunSecToolsStep).toHaveBeenCalled();
    expect(mockRunImportStep).toHaveBeenCalled();
  });

  it('continues when optional security-tools step fails', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunSecToolsStep.mockRejectedValueOnce(new Error('tools crashed'));

    await runPipeline(makeScan());

    expect(mockRunImportStep).toHaveBeenCalled();
    expect(mockRunTriageStep).toHaveBeenCalled();
  });

  it('continues when optional triage step fails', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunTriageStep.mockRejectedValueOnce(new Error('triage failed'));

    // Should not throw — triage is optional
    await runPipeline(makeScan());
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
      return Promise.resolve([{ status: 'running', defaultLanguage: 'uk' }]);
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

  it('parallel steps both run even if one fails (non-required)', async () => {
    const { runPipeline } = await import('./pipeline.ts');

    mockRunSecToolsStep.mockRejectedValueOnce(new Error('sec-tools error'));

    await runPipeline(makeScan());

    // ai-research should still have been called
    expect(mockRunAiResearchStep).toHaveBeenCalledTimes(1);
    // import should still run after parallel group
    expect(mockRunImportStep).toHaveBeenCalledTimes(1);
  });
});

// ── logScanEvent ────────────────────────────────────────────────

describe('logScanEvent', () => {
  it('inserts event into scanEvents table', async () => {
    const { logScanEvent } = await import('./pipeline.ts');

    await logScanEvent('scan-1', 'clone', 'info', 'test message', {}, 'repo', 1);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalled();
  });

  it('does not throw on insert failure', async () => {
    const { logScanEvent } = await import('./pipeline.ts');

    mockDb.values.mockRejectedValueOnce(new Error('DB down'));

    // Should not throw
    await logScanEvent('scan-1', null, 'error', 'test', {});
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
    expect(ctx.repoPath).toBe('/workspace/my-repo/repo');
    expect(ctx.reportLanguage).toBe('en');
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

    mockDb.where.mockResolvedValueOnce([{ defaultLanguage: 'uk' }]);

    const ctx = await buildContext(makeScan({ workspaceId: 5 }));

    expect(ctx.reportLanguage).toBe('uk');
  });
});
