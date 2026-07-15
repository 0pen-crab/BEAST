import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/index.ts';
import { tests, findings, findingNotes, contributorAssessments, scanEvents } from '../../db/schema.ts';
import type { PreparedTest, PreparedFinding, TriageDecisionPlan } from '../pipeline-types.ts';

const mockDb = db as any;

// ── Mock contributors ──────────────────────────────────────────────
const mockFindOrCreateContributor = vi.fn();

vi.mock('../../routes/contributors.ts', () => ({
  findOrCreateContributor: (...args: unknown[]) => mockFindOrCreateContributor(...args),
}));

// ── Mock import-results (ingestContributorStats moved to commit) ───
const mockIngestContributorStats = vi.fn();

vi.mock('./import-results.ts', () => ({
  ingestContributorStats: (...args: unknown[]) => mockIngestContributorStats(...args),
}));

// ── Mock entities (addScanFile used to write back the audit report) ─
const mockAddScanFile = vi.fn();

vi.mock('../entities.ts', () => ({
  addScanFile: (...args: unknown[]) => mockAddScanFile(...args),
}));

// ── Transaction mock ───────────────────────────────────────────────
// Records every operation the commit runs inside db.transaction so the tests
// can assert exact writes, order, and rollback semantics.

interface TxOp {
  op: 'select' | 'insert' | 'update' | 'delete';
  table: unknown;
  values?: any;
  set?: any;
}

function makeTxMock(opts: {
  /** rows returned by select().from(table).where() per table */
  selects?: Map<unknown, unknown[]>;
  /** rows returned by update(...).returning() — consumed in call order */
  updateReturning?: unknown[][];
} = {}) {
  const ops: TxOp[] = [];
  let nextId = 1000;
  const updateReturningQueue = [...(opts.updateReturning ?? [])];

  const tx = {
    ops,
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          ops.push({ op: 'select', table });
          return Promise.resolve(opts.selects?.get(table) ?? []);
        }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: any) => {
        ops.push({ op: 'insert', table, values });
        const p: any = Promise.resolve(undefined);
        p.returning = vi.fn(() => Promise.resolve([{ id: nextId++ }]));
        return p;
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((set: any) => ({
        where: vi.fn(() => {
          ops.push({ op: 'update', table, set });
          const p: any = Promise.resolve(undefined);
          p.returning = vi.fn(() => Promise.resolve(
            updateReturningQueue.length > 0 ? updateReturningQueue.shift() : [],
          ));
          return p;
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(() => {
        ops.push({ op: 'delete', table });
        const p: any = Promise.resolve(undefined);
        p.returning = vi.fn(() => Promise.resolve([]));
        return p;
      }),
    })),
  };
  return tx;
}

function installTx(tx: ReturnType<typeof makeTxMock>) {
  mockDb.transaction = vi.fn(async (cb: any) => cb(tx));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
  delete mockDb.then;
  mockDb.transaction = vi.fn(async (cb: any) => cb(makeTxMock()));
  mockIngestContributorStats.mockResolvedValue([]);
  mockAddScanFile.mockResolvedValue(undefined);
});

// ── Fixtures ───────────────────────────────────────────────────────

const makeCtx = (overrides = {}): any => ({
  scanId: 'scan-1',
  repositoryId: 42,
  repoUrl: 'https://example.com/repo',
  repoName: 'test-repo',
  branch: 'main',
  commitHash: 'abc',
  localPath: '',
  teamName: 'team1',
  workspaceName: 'ws1',
  workspaceId: 10,
  repoBaseDir: '/tmp',
  workDir: '/tmp',
  repoPath: '/tmp/repo',
  toolsDir: '/tmp/results',
  agentDir: '/tmp',
  resultsDir: '/tmp/results',
  profilePath: '/tmp/repo-profile.md',
  scanContextPath: '/tmp/scan-context.md',
  cloneUrl: 'https://example.com/repo.git',
  reportLanguage: 'en',
  aiAnalysisEnabled: true,
  aiScanningEnabled: true,
  aiTriageEnabled: true,
  aiModelAnalyzer: 'sonnet',
  aiModelScanner: 'opus',
  aiModelTriage: 'opus',
  ...overrides,
});

function makePreparedTest(overrides: Partial<PreparedTest> = {}): PreparedTest {
  return {
    key: 'gitleaks',
    tool: 'gitleaks',
    scanType: 'Gitleaks Scan',
    fileName: 'gitleaks-results.json',
    findingsCount: 1,
    ...overrides,
  };
}

function makePreparedFinding(overrides: Partial<PreparedFinding> = {}): PreparedFinding {
  return {
    tempId: 0,
    testKey: 'gitleaks',
    title: 'Secret found',
    severity: 'High',
    description: 'desc',
    filePath: 'a.ts',
    line: 1,
    vulnIdFromTool: 'secret',
    tool: 'gitleaks',
    category: 'secrets',
    fingerprint: 'fp-0',
    ...overrides,
  };
}

const basePrev = (overrides: Record<string, unknown> = {}) => ({
  repositoryId: 42,
  workspaceId: 10,
  preparedTests: [makePreparedTest()],
  preparedFindings: [makePreparedFinding()],
  decisions: [] as TriageDecisionPlan[],
  devAssessments: [],
  analyzerAssessments: [],
  resultFiles: [],
  ...overrides,
});

// ── Module exports ─────────────────────────────────────────────────

describe('commit-results module exports', () => {
  it('exports runCommitStep as a function', async () => {
    const mod = await import('./commit-results.ts');
    expect(typeof mod.runCommitStep).toBe('function');
  });

  it('exports applyAssessmentEnhancements as a function', async () => {
    const mod = await import('./commit-results.ts');
    expect(typeof mod.applyAssessmentEnhancements).toBe('function');
  });
});

// ── runCommitStep — core transaction ───────────────────────────────

describe('runCommitStep', () => {
  it('writes tests and findings inside ONE db.transaction', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev: basePrev() });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    const testInserts = tx.ops.filter(o => o.op === 'insert' && o.table === tests);
    expect(testInserts).toHaveLength(1);
    expect(testInserts[0].values).toEqual(expect.objectContaining({
      scanId: 'scan-1',
      tool: 'gitleaks',
      scanType: 'Gitleaks Scan',
      fileName: 'gitleaks-results.json',
      findingsCount: 1,
      importStatus: 'completed',
    }));

    const findingInserts = tx.ops.filter(o => o.op === 'insert' && o.table === findings);
    expect(findingInserts).toHaveLength(1);
    expect(findingInserts[0].values).toEqual(expect.objectContaining({
      title: 'Secret found',
      severity: 'High',
      tool: 'gitleaks',
      repositoryId: 42,
      fingerprint: 'fp-0',
      status: 'open',
      riskAcceptedReason: null,
    }));
    // The finding is parented onto the test created in the same tx
    expect(findingInserts[0].values.testId).toBeGreaterThanOrEqual(1000);

    expect(result.testsCreated).toBe(1);
    expect(result.findingsNew).toBe(1);
    expect(result.findingsUpdated).toBe(0);
    expect(result.dismissed).toBe(0);
  });

  it('applies triage decisions at insert — findings enter the DB already triaged', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const prev = basePrev({
      preparedFindings: [
        makePreparedFinding({ tempId: 0, fingerprint: 'fp-0' }),
        makePreparedFinding({ tempId: 1, fingerprint: 'fp-1', title: 'Other' }),
      ],
      decisions: [
        { finding_id: 0, action: 'false_positive', reason: 'Test fixture' },
        { finding_id: 1, action: 'keep', reason: 'Real issue' },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev });

    const findingInserts = tx.ops.filter(o => o.op === 'insert' && o.table === findings);
    expect(findingInserts[0].values).toEqual(expect.objectContaining({
      status: 'false_positive',
      riskAcceptedReason: 'Test fixture',
    }));
    expect(findingInserts[1].values).toEqual(expect.objectContaining({
      status: 'open',
      riskAcceptedReason: null,
    }));
    expect(result.dismissed).toBe(1);
  });

  it('updates + re-parents matched findings (the WRITE side of dedup) with triage status applied', async () => {
    const tx = makeTxMock({ updateReturning: [[{ id: 555 }]] });
    installTx(tx);

    const prev = basePrev({
      preparedFindings: [
        makePreparedFinding({ tempId: 0, matchedFindingId: 555, secretValue: 'sk-1' }),
      ],
      decisions: [
        { finding_id: 0, action: 'risk_accept', reason: 'Known and accepted' },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev });

    const findingUpdates = tx.ops.filter(o => o.op === 'update' && o.table === findings);
    expect(findingUpdates).toHaveLength(1);
    expect(findingUpdates[0].set).toEqual(expect.objectContaining({
      severity: 'High',
      status: 'risk_accepted',
      riskAcceptedReason: 'Known and accepted',
      secretValue: 'sk-1',
    }));
    expect(findingUpdates[0].set.testId).toBeGreaterThanOrEqual(1000); // re-parented
    expect(findingUpdates[0].set.updatedAt).toBeInstanceOf(Date);

    // No insert for the matched finding
    expect(tx.ops.filter(o => o.op === 'insert' && o.table === findings)).toHaveLength(0);
    expect(result.findingsUpdated).toBe(1);
    expect(result.findingsNew).toBe(0);
    expect(result.dismissed).toBe(1);
  });

  it('PRESERVES manual risk_accepted on fingerprint-matched rows (same rule as semantic matches)', async () => {
    const tx = makeTxMock({
      selects: new Map<unknown, unknown[]>([
        // The fingerprint path reads the row's current disposition before updating
        [findings, [{ status: 'risk_accepted', riskAcceptedReason: 'accepted by security team' }]],
      ]),
      updateReturning: [[{ id: 555 }]],
    });
    installTx(tx);

    const prev = basePrev({
      preparedFindings: [
        makePreparedFinding({ tempId: 0, matchedFindingId: 555 }),
      ],
      decisions: [
        // Fresh auto-triage wants to re-dispose — must NOT touch the manual state
        { finding_id: 0, action: 'false_positive', reason: 'auto says FP' },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev });

    const findingUpdates = tx.ops.filter(o => o.op === 'update' && o.table === findings);
    expect(findingUpdates).toHaveLength(1);
    // Content refreshed, re-parented...
    expect(findingUpdates[0].set.testId).toBeGreaterThanOrEqual(1000);
    // ...but the manual disposition is untouched
    expect(findingUpdates[0].set).not.toHaveProperty('status');
    expect(findingUpdates[0].set).not.toHaveProperty('riskAcceptedReason');
    // No auto-triage note for the suppressed decision
    expect(tx.ops.filter(o => o.op === 'insert' && o.table === findingNotes)).toHaveLength(0);
    expect(result.findingsUpdated).toBe(1);
    expect(result.dismissed).toBe(0);
  });

  it('applies fresh triage to fingerprint-matched rows that were still open', async () => {
    const tx = makeTxMock({
      selects: new Map<unknown, unknown[]>([
        [findings, [{ status: 'open', riskAcceptedReason: null }]],
      ]),
      updateReturning: [[{ id: 555 }]],
    });
    installTx(tx);

    const prev = basePrev({
      preparedFindings: [makePreparedFinding({ tempId: 0, matchedFindingId: 555 })],
      decisions: [
        { finding_id: 0, action: 'risk_accept', reason: 'Known and accepted' },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev });

    const findingUpdates = tx.ops.filter(o => o.op === 'update' && o.table === findings);
    expect(findingUpdates[0].set).toEqual(expect.objectContaining({
      status: 'risk_accepted',
      riskAcceptedReason: 'Known and accepted',
    }));
    expect(result.dismissed).toBe(1);
  });

  it('keeps existing category/secretValue on matched findings when the new parse has none', async () => {
    const tx = makeTxMock({ updateReturning: [[{ id: 555 }]] });
    installTx(tx);

    const prev = basePrev({
      preparedFindings: [
        makePreparedFinding({ tempId: 0, matchedFindingId: 555, category: undefined, secretValue: undefined }),
      ],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev });

    const findingUpdates = tx.ops.filter(o => o.op === 'update' && o.table === findings);
    expect(findingUpdates[0].set).not.toHaveProperty('category');
    expect(findingUpdates[0].set).not.toHaveProperty('secretValue');
  });

  it('falls back to INSERT when the matched finding vanished between prepare and commit', async () => {
    // updateReturning defaults to [] → the matched row no longer exists
    const tx = makeTxMock();
    installTx(tx);

    const prev = basePrev({
      preparedFindings: [makePreparedFinding({ tempId: 0, matchedFindingId: 999 })],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev });

    expect(tx.ops.filter(o => o.op === 'insert' && o.table === findings)).toHaveLength(1);
    expect(result.findingsNew).toBe(1);
    expect(result.findingsUpdated).toBe(0);
  });

  it('resolves duplicate_of temp ids to committed DB ids', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const prev = basePrev({
      preparedFindings: [
        makePreparedFinding({ tempId: 0, fingerprint: 'fp-0' }),
        makePreparedFinding({ tempId: 1, fingerprint: 'fp-1', title: 'Dupe' }),
      ],
      decisions: [
        { finding_id: 1, action: 'duplicate', reason: 'Same as #0', duplicate_of: 0 },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev });

    // The second finding was inserted with status 'duplicate' and then linked
    // to the FIRST finding's freshly-created DB id.
    const findingUpdates = tx.ops.filter(o => o.op === 'update' && o.table === findings && o.set.duplicateOf != null);
    expect(findingUpdates).toHaveLength(1);
    const findingInserts = tx.ops.filter(o => o.op === 'insert' && o.table === findings);
    expect(findingInserts[1].values.status).toBe('duplicate');
    // duplicateOf points at a DB id issued in this tx (the first insert's id)
    expect(findingUpdates[0].set.duplicateOf).toBeGreaterThanOrEqual(1000);
  });

  it('inserts [Auto-Triage] notes for dismissed findings inside the tx', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const prev = basePrev({
      decisions: [
        { finding_id: 0, action: 'false_positive', reason: 'ORM prevents injection' },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev });

    const noteInserts = tx.ops.filter(o => o.op === 'insert' && o.table === findingNotes);
    expect(noteInserts).toHaveLength(1);
    expect(noteInserts[0].values).toEqual(expect.objectContaining({
      author: 'beast-triage',
      noteType: 'triage',
      content: '[Auto-Triage] False positive: ORM prevents injection',
    }));
  });

  it('attributes findings to contributors for non-risk_accept decisions with email', async () => {
    const tx = makeTxMock();
    installTx(tx);
    mockFindOrCreateContributor.mockResolvedValue(100);

    const prev = basePrev({
      preparedFindings: [
        makePreparedFinding({ tempId: 0, fingerprint: 'fp-0' }),
        makePreparedFinding({ tempId: 1, fingerprint: 'fp-1' }),
        makePreparedFinding({ tempId: 2, fingerprint: 'fp-2' }),
      ],
      decisions: [
        { finding_id: 0, action: 'keep', reason: 'Valid', contributor_email: 'dev@test.com', contributor_name: 'Dev User' },
        { finding_id: 1, action: 'risk_accept', reason: 'Accepted', contributor_email: 'other@test.com' },
        { finding_id: 2, action: 'keep', reason: 'No email' },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev });

    // keep + email → attributed; risk_accept and no-email → skipped
    expect(mockFindOrCreateContributor).toHaveBeenCalledTimes(1);
    expect(mockFindOrCreateContributor).toHaveBeenCalledWith('dev@test.com', 'Dev User', 10);

    const attribution = tx.ops.filter(o => o.op === 'update' && o.table === findings && o.set.contributorId != null);
    expect(attribution).toHaveLength(1);
    expect(attribution[0].set.contributorId).toBe(100);
  });

  it('continues when contributor attribution fails for one finding', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const tx = makeTxMock();
      installTx(tx);
      mockFindOrCreateContributor
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(200);

      const prev = basePrev({
        preparedFindings: [
          makePreparedFinding({ tempId: 0, fingerprint: 'fp-0' }),
          makePreparedFinding({ tempId: 1, fingerprint: 'fp-1' }),
        ],
        decisions: [
          { finding_id: 0, action: 'keep', reason: 'Valid', contributor_email: 'fail@test.com' },
          { finding_id: 1, action: 'keep', reason: 'Valid', contributor_email: 'ok@test.com' },
        ] as TriageDecisionPlan[],
      });

      const { runCommitStep } = await import('./commit-results.ts');
      await runCommitStep({ ctx: makeCtx(), prev });

      expect(mockFindOrCreateContributor).toHaveBeenCalledTimes(2);
      const attribution = tx.ops.filter(o => o.op === 'update' && o.table === findings && o.set.contributorId != null);
      expect(attribution).toHaveLength(1);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('FAILS the commit on a plan inconsistency (finding references unknown test)', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const prev = basePrev({
      preparedFindings: [makePreparedFinding({ testKey: 'nonexistent-tool' })],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    await expect(runCommitStep({ ctx: makeCtx(), prev }))
      .rejects.toThrow(/Commit plan inconsistent/);
    // Contributor ingest must NOT run after a failed transaction
    expect(mockIngestContributorStats).not.toHaveBeenCalled();
  });

  it('propagates transaction failures (required step → scan fails, tx rolled back)', async () => {
    mockDb.transaction = vi.fn(async () => { throw new Error('deadlock detected'); });

    const { runCommitStep } = await import('./commit-results.ts');
    await expect(runCommitStep({ ctx: makeCtx(), prev: basePrev() }))
      .rejects.toThrow('deadlock detected');
    expect(mockIngestContributorStats).not.toHaveBeenCalled();
  });

  // ── Idempotent re-run (resume after a mid-commit crash) ─────────

  it('wipes a previous commit attempt before re-committing and screams about it', async () => {
    const tx = makeTxMock({
      selects: new Map<unknown, unknown[]>([
        [tests, [{ id: 1 }]],
        [findings, [{ id: 10 }, { id: 11 }]],
      ]),
    });
    installTx(tx);

    // Global db.insert is used by the scan-event logger
    const values = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev: basePrev() });

    // FK-safe wipe order: detach duplicate_of, delete findings, delete tests, delete assessments
    const wipeOps = tx.ops.filter(o =>
      (o.op === 'update' && o.table === findings && 'duplicateOf' in (o.set ?? {}) && o.set.duplicateOf === null)
      || o.op === 'delete');
    expect(wipeOps.map(o => `${o.op}:${o.table === findings ? 'findings' : o.table === tests ? 'tests' : 'assessments'}`))
      .toEqual(['update:findings', 'delete:findings', 'delete:tests', 'delete:assessments']);

    // Re-commit warning event
    expect(mockDb.insert).toHaveBeenCalledWith(scanEvents);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      stepName: 'commit',
      level: 'warning',
      message: expect.stringContaining('Re-commit'),
    }));
  });

  it('does not scream when there is nothing to wipe (fresh commit)', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const values = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev: basePrev() });

    const warnings = values.mock.calls.filter(c => c[0]?.level === 'warning');
    expect(warnings).toHaveLength(0);
  });

  // ── Post-tx: contributor ingest + summary event ──────────────────

  it('ingests contributor stats/assessments AFTER the transaction and returns assessedContributorIds', async () => {
    const tx = makeTxMock();
    installTx(tx);
    mockIngestContributorStats.mockResolvedValueOnce([100, 200]);

    const resultFiles = [{ key: 'git-stats', filename: 'git-contributor-stats.json', scanType: '_stats', testTitle: '', content_b64: 'W10=' }];
    const analyzerAssessments = [{ email: 'dev@test.com', security: 8 }];
    const prev = basePrev({ resultFiles, analyzerAssessments });

    const { runCommitStep } = await import('./commit-results.ts');
    const ctx = makeCtx();
    const result = await runCommitStep({ ctx, prev });

    expect(mockIngestContributorStats).toHaveBeenCalledTimes(1);
    expect(mockIngestContributorStats).toHaveBeenCalledWith(
      ctx, 'scan-1', 42, resultFiles, analyzerAssessments, 10,
    );
    expect(result.assessedContributorIds).toEqual([100, 200]);

    // Ingest runs after the transaction completed
    expect(mockDb.transaction.mock.invocationCallOrder[0])
      .toBeLessThan(mockIngestContributorStats.mock.invocationCallOrder[0]);
  });

  it('logs an info scan_event summarizing what was committed', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const values = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev: basePrev() });

    expect(mockDb.insert).toHaveBeenCalledWith(scanEvents);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      stepName: 'commit',
      level: 'info',
      source: 'commit',
      message: expect.stringContaining('Committed scan results'),
      details: expect.objectContaining({
        testsCreated: 1,
        findingsNew: 1,
        findingsUpdated: 0,
        dismissed: 0,
      }),
    }));
  });

  it('commits an empty plan without errors (scan with no tool results)', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({
      ctx: makeCtx(),
      prev: basePrev({ preparedTests: [], preparedFindings: [] }),
    });

    expect(result).toEqual(expect.objectContaining({
      testsCreated: 0,
      findingsNew: 0,
      findingsUpdated: 0,
      dismissed: 0,
    }));
  });

  it('tolerates a prev without plan fields (defaults to empty arrays)', async () => {
    const tx = makeTxMock();
    installTx(tx);

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({
      ctx: makeCtx(),
      prev: { repositoryId: 42, workspaceId: 10 },
    });

    expect(result.testsCreated).toBe(0);
    expect(result.assessedContributorIds).toEqual([]);
  });
});

// ── Semantic cross-scan dedup (AI findings, triage `same_as`) ──────
// AI ('beast') findings never fingerprint-match across scans — the triage
// agent matches them semantically and commit UPDATES the existing row instead
// of inserting a duplicate, preserving manual dispositions.

describe('runCommitStep semantic dedup (same_as)', () => {
  const makeBeastFinding = (overrides: Partial<PreparedFinding> = {}) => makePreparedFinding({
    tool: 'beast',
    title: 'Fresh AI title',
    vulnIdFromTool: undefined,
    category: 'sast',
    ...overrides,
  });

  function warningEvents(values: ReturnType<typeof vi.fn>) {
    return values.mock.calls.filter(c => c[0]?.level === 'warning').map(c => String(c[0]?.message));
  }

  function installEventSpy() {
    const values = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values });
    return values;
  }

  it('updates + re-parents the matched AI row and PRESERVES a manual risk_accepted status + reason', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tx = makeTxMock({
        selects: new Map<unknown, unknown[]>([
          [findings, [{ id: 700, tool: 'beast', status: 'risk_accepted', riskAcceptedReason: 'manually accepted by security team', repositoryId: 42 }]],
        ]),
        updateReturning: [[{ id: 700 }]],
      });
      installTx(tx);
      const values = installEventSpy();

      const prev = basePrev({
        preparedFindings: [makeBeastFinding({ tempId: 0, line: 99, description: 'fresh description' })],
        decisions: [
          // Fresh auto-triage says false_positive — must NOT overwrite the manual state
          { finding_id: 0, action: 'false_positive', reason: 'auto says FP', same_as: 700 },
        ] as TriageDecisionPlan[],
      });

      const { runCommitStep } = await import('./commit-results.ts');
      const result = await runCommitStep({ ctx: makeCtx(), prev });

      const findingUpdates = tx.ops.filter(o => o.op === 'update' && o.table === findings);
      expect(findingUpdates).toHaveLength(1);
      // Fresh content lands on the row...
      expect(findingUpdates[0].set).toEqual(expect.objectContaining({
        title: 'Fresh AI title',
        description: 'fresh description',
        severity: 'High',
        line: 99,
        fingerprint: 'fp-0',
      }));
      expect(findingUpdates[0].set.testId).toBeGreaterThanOrEqual(1000); // re-parented
      // ...but the manual disposition is untouched
      expect(findingUpdates[0].set).not.toHaveProperty('status');
      expect(findingUpdates[0].set).not.toHaveProperty('riskAcceptedReason');

      // No duplicate insert, no auto-triage note for the suppressed decision
      expect(tx.ops.filter(o => o.op === 'insert' && o.table === findings)).toHaveLength(0);
      expect(tx.ops.filter(o => o.op === 'insert' && o.table === findingNotes)).toHaveLength(0);

      expect(result.findingsUpdated).toBe(1);
      expect(result.findingsNew).toBe(0);
      expect(result.semanticMatches).toBe(1);
      expect(result.dismissed).toBe(0); // decision was NOT applied
      expect(warningEvents(values)).toEqual([]);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('applies the fresh triage decision when the matched row was still open (note included)', async () => {
    const tx = makeTxMock({
      selects: new Map<unknown, unknown[]>([
        [findings, [{ id: 700, tool: 'beast', status: 'open', riskAcceptedReason: null, repositoryId: 42 }]],
      ]),
      updateReturning: [[{ id: 700 }]],
    });
    installTx(tx);
    installEventSpy();

    const prev = basePrev({
      preparedFindings: [makeBeastFinding({ tempId: 0 })],
      decisions: [
        { finding_id: 0, action: 'risk_accept', reason: 'mitigated nearby', same_as: 700 },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev });

    const findingUpdates = tx.ops.filter(o => o.op === 'update' && o.table === findings);
    expect(findingUpdates[0].set).toEqual(expect.objectContaining({
      status: 'risk_accepted',
      riskAcceptedReason: 'mitigated nearby',
    }));

    const noteInserts = tx.ops.filter(o => o.op === 'insert' && o.table === findingNotes);
    expect(noteInserts).toHaveLength(1);
    expect(noteInserts[0].values.content).toContain('Risk accepted: mitigated nearby');

    expect(result.semanticMatches).toBe(1);
    expect(result.dismissed).toBe(1);
  });

  it('double match onto one existing row: first wins, second becomes an insert with a warning', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tx = makeTxMock({
        selects: new Map<unknown, unknown[]>([
          [findings, [{ id: 700, tool: 'beast', status: 'open', riskAcceptedReason: null, repositoryId: 42 }]],
        ]),
        updateReturning: [[{ id: 700 }]],
      });
      installTx(tx);
      const values = installEventSpy();

      const prev = basePrev({
        preparedFindings: [
          makeBeastFinding({ tempId: 0, fingerprint: 'fp-0' }),
          makeBeastFinding({ tempId: 1, fingerprint: 'fp-1', title: 'Second AI finding' }),
        ],
        decisions: [
          { finding_id: 0, action: 'keep', reason: 'real', same_as: 700 },
          { finding_id: 1, action: 'keep', reason: 'real too', same_as: 700 },
        ] as TriageDecisionPlan[],
      });

      const { runCommitStep } = await import('./commit-results.ts');
      const result = await runCommitStep({ ctx: makeCtx(), prev });

      expect(tx.ops.filter(o => o.op === 'update' && o.table === findings)).toHaveLength(1);
      const inserts = tx.ops.filter(o => o.op === 'insert' && o.table === findings);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].values.title).toBe('Second AI finding');

      expect(result.semanticMatches).toBe(1);
      expect(result.findingsUpdated).toBe(1);
      expect(result.findingsNew).toBe(1);
      expect(warningEvents(values).join('\n')).toContain('first wins');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('falls back to INSERT with a warning when the same_as target no longer exists', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tx = makeTxMock(); // findings select returns [] → target vanished
      installTx(tx);
      const values = installEventSpy();

      const prev = basePrev({
        preparedFindings: [makeBeastFinding({ tempId: 0 })],
        decisions: [
          { finding_id: 0, action: 'keep', reason: 'real', same_as: 700 },
        ] as TriageDecisionPlan[],
      });

      const { runCommitStep } = await import('./commit-results.ts');
      const result = await runCommitStep({ ctx: makeCtx(), prev });

      expect(tx.ops.filter(o => o.op === 'update' && o.table === findings)).toHaveLength(0);
      expect(tx.ops.filter(o => o.op === 'insert' && o.table === findings)).toHaveLength(1);
      expect(result.semanticMatches).toBe(0);
      expect(result.findingsNew).toBe(1);
      expect(warningEvents(values).join('\n')).toContain('no longer exists');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('refuses to update a non-AI target row (only tool=beast rows are eligible targets)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tx = makeTxMock({
        selects: new Map<unknown, unknown[]>([
          [findings, [{ id: 700, tool: 'gitleaks', status: 'open', riskAcceptedReason: null, repositoryId: 42 }]],
        ]),
      });
      installTx(tx);
      const values = installEventSpy();

      const prev = basePrev({
        preparedFindings: [makeBeastFinding({ tempId: 0 })],
        decisions: [
          { finding_id: 0, action: 'keep', reason: 'real', same_as: 700 },
        ] as TriageDecisionPlan[],
      });

      const { runCommitStep } = await import('./commit-results.ts');
      const result = await runCommitStep({ ctx: makeCtx(), prev });

      expect(tx.ops.filter(o => o.op === 'update' && o.table === findings)).toHaveLength(0);
      expect(tx.ops.filter(o => o.op === 'insert' && o.table === findings)).toHaveLength(1);
      expect(result.semanticMatches).toBe(0);
      expect(warningEvents(values).join('\n')).toContain("not an AI ('beast') finding");
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('ignores same_as on a non-AI prepared finding (only tool=beast sources are eligible)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tx = makeTxMock();
      installTx(tx);
      const values = installEventSpy();

      const prev = basePrev({
        preparedFindings: [makePreparedFinding({ tempId: 0, tool: 'semgrep' })],
        decisions: [
          { finding_id: 0, action: 'keep', reason: 'real', same_as: 700 },
        ] as TriageDecisionPlan[],
      });

      const { runCommitStep } = await import('./commit-results.ts');
      const result = await runCommitStep({ ctx: makeCtx(), prev });

      // No target verification query happens for ineligible sources; the
      // finding goes through the normal insert flow.
      expect(tx.ops.filter(o => o.op === 'select' && o.table === findings)).toHaveLength(0);
      expect(tx.ops.filter(o => o.op === 'insert' && o.table === findings)).toHaveLength(1);
      expect(result.semanticMatches).toBe(0);
      expect(warningEvents(values).join('\n')).toContain('not eligible');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('reports semanticMatches in the commit output and summary event', async () => {
    const tx = makeTxMock({
      selects: new Map<unknown, unknown[]>([
        [findings, [{ id: 700, tool: 'beast', status: 'open', riskAcceptedReason: null, repositoryId: 42 }]],
      ]),
      updateReturning: [[{ id: 700 }]],
    });
    installTx(tx);
    const values = installEventSpy();

    const prev = basePrev({
      preparedFindings: [
        makeBeastFinding({ tempId: 0 }),
        makePreparedFinding({ tempId: 1, fingerprint: 'fp-1' }),
      ],
      decisions: [
        { finding_id: 0, action: 'keep', reason: 'real', same_as: 700 },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev });

    expect(result.semanticMatches).toBe(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      message: expect.stringContaining('1 semantically deduplicated'),
      details: expect.objectContaining({ semanticMatches: 1 }),
    }));
  });
});

// ── Verified statistics on the audit report ────────────────────────
// The AI-written Security Audit report must never carry the model's own
// aggregate arithmetic — after committing, the step prepends a stats block
// computed from the committed plan to the stored final-report.md scan_file.

describe('runCommitStep verified statistics', () => {
  const AUDIT_REPORT = '# Security Audit\n\n## Executive Summary\n\nProse here.\n';

  /** The audit report is read via global db.select(...).limit(1). */
  function installReportRow(content: string | null) {
    mockDb.limit.mockResolvedValueOnce(content === null ? [] : [{ content }]);
  }

  it('prepends a DB-derived stats block right after the report H1 via addScanFile upsert', async () => {
    const tx = makeTxMock();
    installTx(tx);
    installReportRow(AUDIT_REPORT);

    const prev = basePrev({
      preparedFindings: [
        makePreparedFinding({ tempId: 0, fingerprint: 'fp-0', severity: 'Critical' }),
        makePreparedFinding({ tempId: 1, fingerprint: 'fp-1', severity: 'High' }),
        makePreparedFinding({ tempId: 2, fingerprint: 'fp-2', severity: 'High' }),
      ],
      decisions: [
        { finding_id: 1, action: 'false_positive', reason: 'fixture' },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev });

    expect(mockAddScanFile).toHaveBeenCalledTimes(1);
    const call = mockAddScanFile.mock.calls[0][0];
    // Same identity → addScanFile's replace-by-name upsert UPDATES the row
    expect(call).toEqual(expect.objectContaining({
      scanId: 'scan-1',
      fileName: 'final-report.md',
      fileType: 'audit',
    }));

    const content = call.content as string;
    expect(content.startsWith('# Security Audit\n\n[//]: # (beast:verified-stats)')).toBe(true);
    expect(content).toContain('## Verified Statistics');
    // Numbers come from the committed plan, not the model
    expect(content).toContain('| Critical | 1 | 0 |');
    expect(content).toContain('| High | 1 | 1 |');
    expect(content).toContain('| **Total** | **2** | **1** |');
    expect(content).toContain('- Security tests: 1');
    expect(content).toContain('- Findings: 3 new, 0 updated');
    expect(content).toContain('- Auto-dismissed by triage: 1');
    // The original report body survives after the block
    expect(content).toContain('## Executive Summary');
    expect(content).toContain('Prose here.');
  });

  it('counts preserved manual dispositions as dismissed rows, not as auto-dismissed', async () => {
    const tx = makeTxMock({
      selects: new Map<unknown, unknown[]>([
        // Fingerprint-matched row carries a manual disposition
        [findings, [{ status: 'risk_accepted', riskAcceptedReason: 'accepted by security team' }]],
      ]),
      updateReturning: [[{ id: 555 }]],
    });
    installTx(tx);
    installReportRow(AUDIT_REPORT);

    const prev = basePrev({
      preparedFindings: [makePreparedFinding({ tempId: 0, matchedFindingId: 555, severity: 'High' })],
      decisions: [
        { finding_id: 0, action: 'false_positive', reason: 'auto says FP' },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev });

    const content = mockAddScanFile.mock.calls[0][0].content as string;
    // The row's FINAL status is dismissed (manual state preserved)...
    expect(content).toContain('| High | 0 | 1 |');
    // ...but this scan's auto-triage dismissed nothing
    expect(content).toContain('- Auto-dismissed by triage: 0');
    expect(content).toContain('- Findings: 0 new, 1 updated');
  });

  it('reports semantic dedup in the block', async () => {
    const tx = makeTxMock({
      selects: new Map<unknown, unknown[]>([
        [findings, [{ id: 700, tool: 'beast', status: 'open', riskAcceptedReason: null, repositoryId: 42 }]],
      ]),
      updateReturning: [[{ id: 700 }]],
    });
    installTx(tx);
    installReportRow(AUDIT_REPORT);

    const prev = basePrev({
      preparedFindings: [makePreparedFinding({ tempId: 0, tool: 'beast', vulnIdFromTool: undefined })],
      decisions: [
        { finding_id: 0, action: 'keep', reason: 'real', same_as: 700 },
      ] as TriageDecisionPlan[],
    });

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx(), prev });

    const content = mockAddScanFile.mock.calls[0][0].content as string;
    expect(content).toContain('- Semantically deduplicated: 1');
    expect(content).toContain('| High | 1 | 0 |');
  });

  it('skips silently when there is no audit report scan_file (triage skipped/disabled)', async () => {
    const tx = makeTxMock();
    installTx(tx);
    installReportRow(null);

    const values = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values });

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({ ctx: makeCtx(), prev: basePrev() });

    expect(mockAddScanFile).not.toHaveBeenCalled();
    expect(result.findingsNew).toBe(1); // commit itself unaffected
    const errors = values.mock.calls.filter(c => c[0]?.level === 'error');
    expect(errors).toHaveLength(0);
  });

  it('emits the Ukrainian block when ctx.reportLanguage is uk', async () => {
    const tx = makeTxMock();
    installTx(tx);
    installReportRow(AUDIT_REPORT);

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({ ctx: makeCtx({ reportLanguage: 'uk' }), prev: basePrev() });

    const content = mockAddScanFile.mock.calls[0][0].content as string;
    expect(content).toContain('## Перевірена статистика');
    expect(content).toContain('| Серйозність | Відкриті | Відхилені тріажем |');
  });

  it('screams but does NOT fail the commit when the report update fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const tx = makeTxMock();
      installTx(tx);
      installReportRow(AUDIT_REPORT);
      mockAddScanFile.mockRejectedValueOnce(new Error('db write failed'));

      const values = vi.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values });

      const { runCommitStep } = await import('./commit-results.ts');
      const result = await runCommitStep({ ctx: makeCtx(), prev: basePrev() });

      expect(result.findingsNew).toBe(1); // findings are safely committed
      const errors = values.mock.calls.filter(c => c[0]?.level === 'error').map(c => String(c[0]?.message));
      expect(errors.join('\n')).toContain('verified statistics');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

// ── applyAssessmentEnhancements ────────────────────────────────────
// Moved from the triage step: appends the triage-produced "### Security
// Findings" section to contributor assessments — AFTER commit's ingest so the
// analyzer assessments exist to append to.

describe('applyAssessmentEnhancements', () => {
  it('appends the security section to an existing assessment (stripping the old one)', async () => {
    mockFindOrCreateContributor.mockResolvedValue(50);
    mockDb.limit.mockResolvedValueOnce([
      { id: 7, feedback: 'Great work\n\n### Security Findings\nOld section' },
    ]);

    const { applyAssessmentEnhancements } = await import('./commit-results.ts');
    await applyAssessmentEnhancements(makeCtx(), [
      { contributor_email: 'dev@test.com', feedback: 'blah\n### Security Findings\nNew section' },
    ]);

    expect(mockDb.update).toHaveBeenCalledWith(contributorAssessments);
    expect(mockDb.set).toHaveBeenCalledWith({
      feedback: 'Great work\n\n### Security Findings\nNew section',
    });
  });

  it('creates a new assessment stamped with the scan id when none exists', async () => {
    mockFindOrCreateContributor.mockResolvedValue(50);
    mockDb.limit.mockResolvedValueOnce([]);

    const { applyAssessmentEnhancements } = await import('./commit-results.ts');
    await applyAssessmentEnhancements(makeCtx(), [
      { email: 'dev@test.com', feedback: '### Security Findings\nFound stuff' },
    ]);

    expect(mockDb.insert).toHaveBeenCalledWith(contributorAssessments);
    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      contributorId: 50,
      repoName: 'test-repo',
      executionId: 'scan-1', // cleanup/wipe finds these rows by execution_id
      feedback: '### Security Findings\nFound stuff',
    }));
  });

  it('skips entries without an email or without a security section', async () => {
    mockFindOrCreateContributor.mockResolvedValue(50);
    mockDb.limit.mockResolvedValue([]);

    const { applyAssessmentEnhancements } = await import('./commit-results.ts');
    await applyAssessmentEnhancements(makeCtx(), [
      { feedback: '### Security Findings\nNo email' },
      { email: 'dev@test.com', feedback: 'No security section here' },
    ]);

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('continues past per-contributor failures', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockFindOrCreateContributor
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(51);
      mockDb.limit.mockResolvedValueOnce([]);

      const { applyAssessmentEnhancements } = await import('./commit-results.ts');
      await applyAssessmentEnhancements(makeCtx(), [
        { email: 'fail@test.com', feedback: '### Security Findings\nA' },
        { email: 'ok@test.com', feedback: '### Security Findings\nB' },
      ]);

      expect(mockDb.insert).toHaveBeenCalledWith(contributorAssessments);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

// ── Mitigation decisions (auto-close verified-fixed findings) ──────
// The mitigation-check step verified in the CODE that old open findings no
// longer reproduce; commit applies those verdicts — status 'fixed' + an
// auto-mitigation note. Only 'fixed' verdicts touch rows; still_present /
// unverifiable findings stay open.

describe('runCommitStep mitigation decisions', () => {
  const mitigationPrev = (decisions: unknown[], overrides: Record<string, unknown> = {}) =>
    basePrev({
      preparedTests: [],
      preparedFindings: [],
      mitigationDecisions: decisions,
      ...overrides,
    });

  it('marks open mitigation targets as fixed with an auto-mitigation note', async () => {
    const tx = makeTxMock({
      selects: new Map([[findings, [{ id: 501, status: 'open' }]]]),
    });
    installTx(tx);

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({
      ctx: makeCtx(),
      prev: mitigationPrev([
        { finding_id: 501, verdict: 'fixed', reason: 'Secret removed from config' },
      ]),
    });

    const findingUpdates = tx.ops.filter(o => o.op === 'update' && o.table === findings);
    expect(findingUpdates).toHaveLength(1);
    expect(findingUpdates[0].set).toEqual(expect.objectContaining({ status: 'fixed' }));

    const noteInserts = tx.ops.filter(o => o.op === 'insert' && o.table === findingNotes);
    expect(noteInserts).toHaveLength(1);
    expect(noteInserts[0].values).toEqual(expect.objectContaining({
      findingId: 501,
      author: 'beast-mitigation',
      noteType: 'mitigation',
      content: expect.stringContaining('Secret removed from config'),
    }));

    expect(result.findingsFixed).toBe(1);
  });

  it('ignores still_present and unverifiable verdicts (rows stay open)', async () => {
    const tx = makeTxMock({
      selects: new Map([[findings, [{ id: 501, status: 'open' }, { id: 502, status: 'open' }]]]),
    });
    installTx(tx);

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({
      ctx: makeCtx(),
      prev: mitigationPrev([
        { finding_id: 501, verdict: 'still_present', reason: 'Vuln still in code' },
        { finding_id: 502, verdict: 'unverifiable', reason: 'No verdict from agent' },
      ]),
    });

    expect(tx.ops.filter(o => o.op === 'update' && o.table === findings)).toHaveLength(0);
    expect(tx.ops.filter(o => o.op === 'insert' && o.table === findingNotes)).toHaveLength(0);
    expect(result.findingsFixed).toBe(0);
  });

  it('is idempotent on re-commit: an already-fixed target is counted without a duplicate note', async () => {
    const tx = makeTxMock({
      selects: new Map([[findings, [{ id: 501, status: 'fixed' }]]]),
    });
    installTx(tx);

    const { runCommitStep } = await import('./commit-results.ts');
    const result = await runCommitStep({
      ctx: makeCtx(),
      prev: mitigationPrev([
        { finding_id: 501, verdict: 'fixed', reason: 'Secret removed' },
      ]),
    });

    expect(tx.ops.filter(o => o.op === 'update' && o.table === findings)).toHaveLength(0);
    expect(tx.ops.filter(o => o.op === 'insert' && o.table === findingNotes)).toHaveLength(0);
    expect(result.findingsFixed).toBe(1);
  });

  it('warns and skips when the target is no longer open (manual disposition raced the scan)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tx = makeTxMock({
        selects: new Map([[findings, [{ id: 501, status: 'risk_accepted' }]]]),
      });
      installTx(tx);

      const { runCommitStep } = await import('./commit-results.ts');
      const result = await runCommitStep({
        ctx: makeCtx(),
        prev: mitigationPrev([
          { finding_id: 501, verdict: 'fixed', reason: 'Secret removed' },
        ]),
      });

      expect(tx.ops.filter(o => o.op === 'update' && o.table === findings)).toHaveLength(0);
      expect(result.findingsFixed).toBe(0);

      // A warning scan event screams about the skipped target
      const warningEvents = mockDb.values.mock.calls
        .filter((c: any[]) => c[0]?.level === 'warning')
        .map((c: any[]) => String(c[0]?.message ?? ''));
      expect(warningEvents.join('\n')).toContain('501');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('warns and skips when the target row vanished', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tx = makeTxMock({ selects: new Map([[findings, []]]) });
      installTx(tx);

      const { runCommitStep } = await import('./commit-results.ts');
      const result = await runCommitStep({
        ctx: makeCtx(),
        prev: mitigationPrev([
          { finding_id: 501, verdict: 'fixed', reason: 'Secret removed' },
        ]),
      });

      expect(result.findingsFixed).toBe(0);
      const warningEvents = mockDb.values.mock.calls
        .filter((c: any[]) => c[0]?.level === 'warning')
        .map((c: any[]) => String(c[0]?.message ?? ''));
      expect(warningEvents.join('\n')).toContain('501');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('includes findingsFixed in the commit summary event', async () => {
    const tx = makeTxMock({
      selects: new Map([[findings, [{ id: 501, status: 'open' }]]]),
    });
    installTx(tx);
    const values = mockDb.values;

    const { runCommitStep } = await import('./commit-results.ts');
    await runCommitStep({
      ctx: makeCtx(),
      prev: mitigationPrev([
        { finding_id: 501, verdict: 'fixed', reason: 'Removed' },
      ]),
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      message: expect.stringContaining('auto-fixed'),
      details: expect.objectContaining({ findingsFixed: 1 }),
    }));
  });
});
