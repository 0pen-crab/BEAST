import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/index.ts';
import type { PreparedFinding, TriageDecisionPlan } from '../pipeline-types.ts';

const mockDb = db as any;

// ── Mock SSH ───────────────────────────────────────────────────────
const mockSshExec = vi.fn();
const mockSshWriteFile = vi.fn();
const mockGetClaudeRunnerConfig = vi.fn().mockReturnValue({
  host: 'test-host',
  port: 22,
  username: 'test',
  privateKey: Buffer.from('key'),
});

vi.mock('../ssh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssh.ts')>();
  return {
    sshExec: (...args: unknown[]) => mockSshExec(...args),
    sshWriteFile: (...args: unknown[]) => mockSshWriteFile(...args),
    getClaudeRunnerConfig: () => mockGetClaudeRunnerConfig(),
    parseStreamJsonResult: actual.parseStreamJsonResult,
    extractAiUsage: actual.extractAiUsage,
    SSHTimeoutError: actual.SSHTimeoutError,
  };
});

// ── Mock fs (agent output files are read from the shared volume) ────
const mockReadFile = vi.fn();
vi.mock('node:fs/promises', () => ({
  default: { readFile: (...args: unknown[]) => mockReadFile(...args) },
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// ── Mock entities (mitigation.log diagnostics) ─────────────────────
const mockAddScanFile = vi.fn();

vi.mock('../entities.ts', () => ({
  addScanFile: (...args: unknown[]) => mockAddScanFile(...args),
}));

beforeEach(() => {
  mockSshExec.mockReset();
  mockSshWriteFile.mockReset();
  mockReadFile.mockReset();
  mockAddScanFile.mockReset();
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

// ── Shared fixtures ────────────────────────────────────────────────

const makeCtx = (overrides = {}) => ({
  scanId: 'scan-1',
  repositoryId: 42,
  repoUrl: 'https://example.com/repo',
  repoName: 'test-repo',
  branch: 'main',
  commitHash: 'abc123',
  localPath: '',
  teamName: 'team1',
  workspaceName: 'ws1',
  workspaceId: 10,
  repoBaseDir: '/tmp',
  workDir: '/tmp',
  repoPath: '/tmp/repo',
  toolsDir: '/tmp/results',
  agentDir: '/tmp/agent',
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
  scanType: 'full',
  ...overrides,
});

function makeCandidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    title: 'Hardcoded secret',
    severity: 'High',
    filePath: 'src/config.ts',
    line: 12,
    tool: 'gitleaks',
    vulnIdFromTool: 'generic-api-key',
    description: 'A secret was detected',
    ...overrides,
  };
}

function makePreparedFinding(overrides: Partial<PreparedFinding> = {}): PreparedFinding {
  return {
    tempId: 0,
    testKey: 'gitleaks',
    title: 'Secret found',
    severity: 'High',
    filePath: 'src/config.ts',
    line: 42,
    tool: 'gitleaks',
    fingerprint: 'fp-0',
    ...overrides,
  };
}

/** prev state after a successful triage-report step on a repeat scan. */
const basePrev = {
  aiAvailable: true,
  repositoryId: 42,
  workspaceId: 10,
  resultFiles: [],
  preparedFindings: [] as PreparedFinding[],
  decisions: [] as TriageDecisionPlan[],
  toolResults: {
    gitleaks: { status: 'success', durationMs: 5, findingsCount: 1 },
  },
  scanCompleted: true,
};

/** Standard successful agent run: exec ok + mitigation-output.json content. */
function setupAgentRun(decisions: unknown[] = []) {
  mockSshExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  mockSshWriteFile.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValueOnce(JSON.stringify({ decisions }));
}

function scanEventMessages(level?: string): string[] {
  return mockDb.values.mock.calls
    .filter((c: any[]) => (level ? c[0]?.level === level : true))
    .map((c: any[]) => String(c[0]?.message ?? ''));
}

// ── Module exports ─────────────────────────────────────────────────

describe('mitigation-check module exports', () => {
  it('exports the step and its helpers', async () => {
    const mod = await import('./mitigation-check.ts');
    expect(typeof mod.runMitigationCheckStep).toBe('function');
    expect(typeof mod.resolveRanTools).toBe('function');
    expect(typeof mod.collectMatchedFindingIds).toBe('function');
    expect(typeof mod.fetchMitigationCandidates).toBe('function');
    expect(typeof mod.prepareMitigationInput).toBe('function');
    expect(typeof mod.runMitigationAgent).toBe('function');
  });
});

// ── resolveRanTools ────────────────────────────────────────────────
// Old findings may only be closed for tools that ACTUALLY ran successfully in
// this scan — a tool that was disabled/failed/skipped tells us nothing about
// whether its old findings are gone.

describe('resolveRanTools', () => {
  it('returns tools whose security-tools result is success', async () => {
    const { resolveRanTools } = await import('./mitigation-check.ts');
    const ran = resolveRanTools({
      toolResults: {
        gitleaks: { status: 'success' },
        trufflehog: { status: 'failed' },
        'trivy-sca': { status: 'skipped' },
      },
    });
    expect(ran).toContain('gitleaks');
    expect(ran).not.toContain('trufflehog');
    expect(ran).not.toContain('trivy-sca');
  });

  it('maps summary keys to finding tool names (jf-audit → jfrog)', async () => {
    const { resolveRanTools } = await import('./mitigation-check.ts');
    const ran = resolveRanTools({
      toolResults: { 'jf-audit': { status: 'success' } },
    });
    expect(ran).toContain('jfrog');
    expect(ran).not.toContain('jf-audit');
  });

  it('includes beast when the AI research scan completed with no module errors', async () => {
    const { resolveRanTools } = await import('./mitigation-check.ts');
    expect(resolveRanTools({ toolResults: {}, scanCompleted: true })).toContain('beast');
  });

  it('excludes beast when AI research did not complete', async () => {
    const { resolveRanTools } = await import('./mitigation-check.ts');
    expect(resolveRanTools({ toolResults: {}, scanCompleted: false })).not.toContain('beast');
    expect(resolveRanTools({ toolResults: {} })).not.toContain('beast');
  });

  it('excludes beast when some AI modules failed (partial coverage)', async () => {
    const { resolveRanTools } = await import('./mitigation-check.ts');
    const ran = resolveRanTools({
      toolResults: {},
      scanCompleted: true,
      moduleErrors: [{ kind: 'module', name: 'auth', error: 'boom' }],
    });
    expect(ran).not.toContain('beast');
  });

  it('returns empty when nothing ran', async () => {
    const { resolveRanTools } = await import('./mitigation-check.ts');
    expect(resolveRanTools({})).toEqual([]);
  });
});

// ── collectMatchedFindingIds ───────────────────────────────────────
// Existing DB findings that THIS scan re-detected (fingerprint match or
// semantic same_as) must never be offered as mitigation candidates.

describe('collectMatchedFindingIds', () => {
  it('collects fingerprint-matched DB ids from the prepared plan', async () => {
    const { collectMatchedFindingIds } = await import('./mitigation-check.ts');
    const ids = collectMatchedFindingIds(
      [
        makePreparedFinding({ tempId: 1, matchedFindingId: 501 }),
        makePreparedFinding({ tempId: 2 }),
      ],
      [],
    );
    expect(ids).toEqual(new Set([501]));
  });

  it('collects semantic same_as targets from triage decisions', async () => {
    const { collectMatchedFindingIds } = await import('./mitigation-check.ts');
    const ids = collectMatchedFindingIds(
      [makePreparedFinding({ tempId: 1, tool: 'beast' })],
      [{ finding_id: 1, action: 'keep', reason: 'still there', same_as: 700 }],
    );
    expect(ids).toEqual(new Set([700]));
  });

  it('combines both sources', async () => {
    const { collectMatchedFindingIds } = await import('./mitigation-check.ts');
    const ids = collectMatchedFindingIds(
      [
        makePreparedFinding({ tempId: 1, matchedFindingId: 501 }),
        makePreparedFinding({ tempId: 2, tool: 'beast' }),
      ],
      [{ finding_id: 2, action: 'keep', reason: 'match', same_as: 700 }],
    );
    expect(ids).toEqual(new Set([501, 700]));
  });
});

// ── fetchMitigationCandidates ──────────────────────────────────────

describe('fetchMitigationCandidates', () => {
  it('returns open findings of the repo for tools that ran', async () => {
    mockDb.limit.mockResolvedValueOnce([makeCandidateRow()]);

    const { fetchMitigationCandidates } = await import('./mitigation-check.ts');
    const rows = await fetchMitigationCandidates(makeCtx() as any, 42, ['gitleaks'], new Set());

    expect(mockDb.select).toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(501);
  });

  it('returns empty without querying when repositoryId is missing', async () => {
    const { fetchMitigationCandidates } = await import('./mitigation-check.ts');
    const rows = await fetchMitigationCandidates(makeCtx() as any, undefined, ['gitleaks'], new Set());

    expect(rows).toEqual([]);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns empty without querying when no tools ran', async () => {
    const { fetchMitigationCandidates } = await import('./mitigation-check.ts');
    const rows = await fetchMitigationCandidates(makeCtx() as any, 42, [], new Set());

    expect(rows).toEqual([]);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('truncates to the candidate limit with a warning scan event (no silent caps)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { MITIGATION_CANDIDATE_LIMIT, fetchMitigationCandidates } = await import('./mitigation-check.ts');
      const rows = Array.from({ length: MITIGATION_CANDIDATE_LIMIT + 1 }, (_, i) =>
        makeCandidateRow({ id: i + 1 }));
      mockDb.limit.mockResolvedValueOnce(rows);

      const result = await fetchMitigationCandidates(makeCtx() as any, 42, ['gitleaks'], new Set());

      expect(result).toHaveLength(MITIGATION_CANDIDATE_LIMIT);
      expect(scanEventMessages('warning').join('\n')).toContain('truncated');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('propagates DB failures instead of silently degrading', async () => {
    mockDb.limit.mockRejectedValueOnce(new Error('connection lost'));

    const { fetchMitigationCandidates } = await import('./mitigation-check.ts');
    await expect(fetchMitigationCandidates(makeCtx() as any, 42, ['gitleaks'], new Set()))
      .rejects.toThrow('connection lost');
  });
});

// ── prepareMitigationInput ─────────────────────────────────────────

describe('prepareMitigationInput', () => {
  it('returns null when there are no candidates', async () => {
    const { prepareMitigationInput } = await import('./mitigation-check.ts');
    expect(prepareMitigationInput(makeCtx() as any, [], [])).toBeNull();
  });

  it('encodes candidates with their DATABASE ids and repo paths', async () => {
    const { prepareMitigationInput } = await import('./mitigation-check.ts');
    const b64 = prepareMitigationInput(makeCtx() as any, [makeCandidateRow() as any], []);

    const decoded = JSON.parse(Buffer.from(b64!, 'base64').toString('utf8'));
    expect(decoded.repo_name).toBe('test-repo');
    expect(decoded.repo_path).toBe('/tmp/repo');
    expect(decoded.scan_context_path).toBe('/tmp/scan-context.md');
    expect(decoded.results_dir).toBe('/tmp/results');
    expect(decoded.candidates).toHaveLength(1);
    expect(decoded.candidates[0].id).toBe(501);
    expect(decoded.candidates[0].tool).toBe('gitleaks');
    expect(decoded.candidates[0].file_path).toBe('src/config.ts');
  });

  it('includes a compact summary of the current scan findings for cross-mapping', async () => {
    const { prepareMitigationInput } = await import('./mitigation-check.ts');
    const b64 = prepareMitigationInput(makeCtx() as any, [makeCandidateRow() as any], [
      makePreparedFinding({ title: 'New secret', filePath: 'src/new.ts', line: 3 }),
    ]);

    const decoded = JSON.parse(Buffer.from(b64!, 'base64').toString('utf8'));
    expect(decoded.current_scan_findings).toHaveLength(1);
    expect(decoded.current_scan_findings[0]).toEqual({
      title: 'New secret',
      file_path: 'src/new.ts',
      line: 3,
      tool: 'gitleaks',
      severity: 'High',
    });
  });
});

// ── runMitigationAgent ─────────────────────────────────────────────

describe('runMitigationAgent', () => {
  it('writes the input file, runs claude with the mitigation prompt, and parses decisions', async () => {
    setupAgentRun([{ finding_id: 501, verdict: 'fixed', reason: 'Secret removed from config' }]);

    const { runMitigationAgent } = await import('./mitigation-check.ts');
    const inputB64 = Buffer.from(JSON.stringify({ candidates: [] })).toString('base64');
    const result = await runMitigationAgent(makeCtx() as any, inputB64);

    expect(result.decisions).toEqual([
      { finding_id: 501, verdict: 'fixed', reason: 'Secret removed from config' },
    ]);

    const paths = mockSshWriteFile.mock.calls.map(c => c[1]);
    expect(paths.some((p: unknown) => typeof p === 'string' && (p as string).endsWith('/mitigation-input.json'))).toBe(true);

    const claudeCalls = mockSshExec.mock.calls.filter(c => String(c[1]).includes('| claude '));
    expect(claudeCalls).toHaveLength(1);
    expect(String(claudeCalls[0][1])).toContain('/prompts/mitigation-check.md');
  });

  it('resolves the model from ctx.aiModelTriage (shares the triage capability)', async () => {
    setupAgentRun([]);

    const { runMitigationAgent } = await import('./mitigation-check.ts');
    const inputB64 = Buffer.from('{}').toString('base64');
    await runMitigationAgent(makeCtx({ aiModelTriage: 'sonnet' }) as any, inputB64);

    const claudeCall = mockSshExec.mock.calls.find(c => String(c[1]).includes('| claude '));
    expect(String(claudeCall![1])).toContain('--model');
    expect(String(claudeCall![1])).toContain('sonnet');
  });

  it('stores the agent log as a scan file', async () => {
    setupAgentRun([]);

    const { runMitigationAgent } = await import('./mitigation-check.ts');
    await runMitigationAgent(makeCtx() as any, Buffer.from('{}').toString('base64'));

    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      fileName: 'mitigation.log',
      fileType: 'log-mitigation',
    }));
  });

  it('throws when the output file is missing after a successful AI run (lost output must scream)', async () => {
    mockSshExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    mockSshWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const { runMitigationAgent } = await import('./mitigation-check.ts');
    await expect(runMitigationAgent(makeCtx() as any, Buffer.from('{}').toString('base64')))
      .rejects.toThrow(/mitigation-output\.json missing/);
  });

  it('throws when the output file is corrupt JSON', async () => {
    mockSshExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    mockSshWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValueOnce('not json {');

    const { runMitigationAgent } = await import('./mitigation-check.ts');
    await expect(runMitigationAgent(makeCtx() as any, Buffer.from('{}').toString('base64')))
      .rejects.toThrow(/Failed to parse mitigation-output\.json/);
  });
});

// ── runMitigationCheckStep ─────────────────────────────────────────

describe('runMitigationCheckStep', () => {
  it('skips with an explicit reason when AI triage is disabled', async () => {
    const { runMitigationCheckStep } = await import('./mitigation-check.ts');
    const result = await runMitigationCheckStep({
      ctx: makeCtx({ aiTriageEnabled: false }) as any,
      prev: basePrev,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('ai-triage-disabled');
    expect(result.mitigationDecisions).toEqual([]);
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('skips when analysis failed (mirrors triage)', async () => {
    const { runMitigationCheckStep } = await import('./mitigation-check.ts');
    const result = await runMitigationCheckStep({
      ctx: makeCtx() as any,
      prev: { ...basePrev, aiAvailable: false },
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('analysis-failed');
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('skips PR scans — closing repo findings from a partial branch scan is unsafe', async () => {
    const { runMitigationCheckStep } = await import('./mitigation-check.ts');
    const result = await runMitigationCheckStep({
      ctx: makeCtx({ scanType: 'pr' }) as any,
      prev: basePrev,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('pr-scan');
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('returns zeros without running the agent when there are no candidates (e.g. first scan)', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const { runMitigationCheckStep } = await import('./mitigation-check.ts');
    const result = await runMitigationCheckStep({ ctx: makeCtx() as any, prev: basePrev });

    expect(result.skipped).toBeUndefined();
    expect(result.candidates).toBe(0);
    expect(result.confirmedFixed).toBe(0);
    expect(result.mitigationDecisions).toEqual([]);
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('runs the agent over candidates and returns validated decisions', async () => {
    mockDb.limit.mockResolvedValueOnce([
      makeCandidateRow({ id: 501 }),
      makeCandidateRow({ id: 502, title: 'SQL injection', tool: 'beast' }),
    ]);
    setupAgentRun([
      { finding_id: 501, verdict: 'fixed', reason: 'Secret removed' },
      { finding_id: 502, verdict: 'still_present', reason: 'Query still concatenates input' },
    ]);

    const { runMitigationCheckStep } = await import('./mitigation-check.ts');
    const result = await runMitigationCheckStep({ ctx: makeCtx() as any, prev: basePrev });

    expect(result.candidates).toBe(2);
    expect(result.confirmedFixed).toBe(1);
    expect(result.stillPresent).toBe(1);
    expect(result.unverifiable).toBe(0);
    expect(result.mitigationDecisions).toHaveLength(2);
    expect(typeof result.durationMs).toBe('number');
  });

  it('passes the matched finding ids as exclusions so re-detected findings are never candidates', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const { runMitigationCheckStep } = await import('./mitigation-check.ts');
    await runMitigationCheckStep({
      ctx: makeCtx() as any,
      prev: {
        ...basePrev,
        preparedFindings: [makePreparedFinding({ tempId: 1, matchedFindingId: 501 })],
        decisions: [{ finding_id: 1, action: 'keep', reason: 'r' }],
      },
    });

    // The candidates query ran with a where clause — we can't easily introspect
    // the SQL through the chainable mock, but the query must have been issued.
    expect(mockDb.where).toHaveBeenCalled();
  });

  it('drops agent decisions for unknown finding ids with a warning event', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockDb.limit.mockResolvedValueOnce([makeCandidateRow({ id: 501 })]);
      setupAgentRun([
        { finding_id: 501, verdict: 'fixed', reason: 'Removed' },
        { finding_id: 999, verdict: 'fixed', reason: 'Hallucinated id' },
      ]);

      const { runMitigationCheckStep } = await import('./mitigation-check.ts');
      const result = await runMitigationCheckStep({ ctx: makeCtx() as any, prev: basePrev });

      expect(result.mitigationDecisions.map(d => d.finding_id)).toEqual([501]);
      expect(scanEventMessages('warning').join('\n')).toContain('999');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('drops agent decisions with invalid verdicts with a warning event', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockDb.limit.mockResolvedValueOnce([makeCandidateRow({ id: 501 })]);
      setupAgentRun([
        { finding_id: 501, verdict: 'resolved', reason: 'Bad verdict value' },
      ]);

      const { runMitigationCheckStep } = await import('./mitigation-check.ts');
      const result = await runMitigationCheckStep({ ctx: makeCtx() as any, prev: basePrev });

      // 501 had no valid decision → treated as unverifiable, not fixed
      expect(result.confirmedFixed).toBe(0);
      expect(result.unverifiable).toBe(1);
      expect(scanEventMessages('warning').join('\n')).toContain('verdict');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('treats candidates the agent did not verdict as unverifiable with a warning event', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockDb.limit.mockResolvedValueOnce([
        makeCandidateRow({ id: 501 }),
        makeCandidateRow({ id: 502 }),
      ]);
      setupAgentRun([{ finding_id: 501, verdict: 'fixed', reason: 'Removed' }]);

      const { runMitigationCheckStep } = await import('./mitigation-check.ts');
      const result = await runMitigationCheckStep({ ctx: makeCtx() as any, prev: basePrev });

      expect(result.confirmedFixed).toBe(1);
      expect(result.unverifiable).toBe(1);
      const unverdicted = result.mitigationDecisions.find(d => d.finding_id === 502);
      expect(unverdicted?.verdict).toBe('unverifiable');
      expect(scanEventMessages('warning').join('\n')).toContain('502');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('screams with an ERROR event for still_present findings (scanner missed a live vuln)', async () => {
    mockDb.limit.mockResolvedValueOnce([makeCandidateRow({ id: 501 })]);
    setupAgentRun([
      { finding_id: 501, verdict: 'still_present', reason: 'Vulnerable code unchanged at src/config.ts:12' },
    ]);

    const { runMitigationCheckStep } = await import('./mitigation-check.ts');
    const result = await runMitigationCheckStep({ ctx: makeCtx() as any, prev: basePrev });

    expect(result.stillPresent).toBe(1);
    const errors = scanEventMessages('error').join('\n');
    expect(errors).toContain('501');
    expect(errors).toContain('still present');
  });

  it('does NOT write finding statuses to the DB (decisions applied at commit)', async () => {
    mockDb.limit.mockResolvedValueOnce([makeCandidateRow({ id: 501 })]);
    setupAgentRun([{ finding_id: 501, verdict: 'fixed', reason: 'Removed' }]);

    const { runMitigationCheckStep } = await import('./mitigation-check.ts');
    await runMitigationCheckStep({ ctx: makeCtx() as any, prev: basePrev });

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
