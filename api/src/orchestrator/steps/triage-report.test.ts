import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/index.ts';
import type { PreparedFinding } from '../pipeline-types.ts';

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

// ── Mock fs ───────────────────────────────────────────────────────
const mockReadFile = vi.fn();
vi.mock('node:fs/promises', () => ({
  default: { readFile: (...args: unknown[]) => mockReadFile(...args) },
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// ── Mock entities ──────────────────────────────────────────────────
const mockAddScanFile = vi.fn();

vi.mock('../entities.ts', () => ({
  addScanFile: (...args: unknown[]) => mockAddScanFile(...args),
}));

// ── Mock import-results (storeReports — scan_files diagnostics) ────
const mockStoreReports = vi.fn();

vi.mock('./import-results.ts', () => ({
  storeReports: (...args: unknown[]) => mockStoreReports(...args),
}));

vi.mock('../prompt-languages.ts', () => ({
  getLanguageInstruction: (lang: string) => lang === 'uk' ? 'Пиши Українською.' : '',
}));

beforeEach(() => {
  mockSshExec.mockReset();
  mockSshWriteFile.mockReset();
  mockReadFile.mockReset();
  mockAddScanFile.mockReset();
  mockStoreReports.mockReset();
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

// ── Shared ctx factory ─────────────────────────────────────────────

const makeCtx = (overrides = {}) => ({
  scanId: 'scan-1',
  repositoryId: 999,
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

function makePreparedFinding(overrides: Partial<PreparedFinding> = {}): PreparedFinding {
  return {
    tempId: 0,
    testKey: 'gitleaks',
    title: 'Secret found',
    severity: 'High',
    description: 'A secret was detected',
    filePath: 'src/config.ts',
    line: 42,
    vulnIdFromTool: 'generic-api-key',
    tool: 'gitleaks',
    category: 'secrets',
    fingerprint: 'fp-0',
    ...overrides,
  };
}

// ── Module exports ─────────────────────────────────────────────────

describe('triage-report module exports', () => {
  it('exports prepareTriageInput as a function', async () => {
    const mod = await import('./triage-report.ts');
    expect(typeof mod.prepareTriageInput).toBe('function');
  });

  it('exports runTriageAndReport as a function', async () => {
    const mod = await import('./triage-report.ts');
    expect(typeof mod.runTriageAndReport).toBe('function');
  });

  it('exports runTriageStep as a function', async () => {
    const mod = await import('./triage-report.ts');
    expect(typeof mod.runTriageStep).toBe('function');
  });
});

// ── prepareTriageInput ─────────────────────────────────────────────
// Triage operates on the PREPARED plan, not the DB — findings are keyed by
// their temp ids because DB ids don't exist until the commit step runs.

describe('prepareTriageInput', () => {
  it('returns null when the prepared plan has no findings', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx() as any, [], []);

    expect(result).toBeNull();
  });

  it('returns a base64-encoded JSON string keyed by temp ids when prepared findings exist', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx() as any, [
      makePreparedFinding({ tempId: 7 }),
    ], []);

    expect(result).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
    expect(decoded.repo_name).toBe('test-repo');
    expect(decoded.findings).toHaveLength(1);
    expect(decoded.findings[0].id).toBe(7); // temp id, NOT a DB id
    expect(decoded.findings[0].tool).toBe('gitleaks');
  });

  it('includes code_context from the prepared codeSnippet field', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx() as any, [
      makePreparedFinding({
        tempId: 1,
        title: 'SQL Injection',
        tool: 'beast',
        category: 'sast',
        vulnIdFromTool: 'CWE-89',
        codeSnippet: '>   10 | db.query(userInput)',
      }),
    ], []);

    expect(result).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
    expect(decoded.findings[0].code_context).toBe('>   10 | db.query(userInput)');
  });

  it('omits code_context when codeSnippet is absent', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx() as any, [
      makePreparedFinding({ codeSnippet: undefined }),
    ], []);

    const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
    expect(decoded.findings[0].code_context).toBeUndefined();
  });

  it('includes secret_value for secrets findings', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx() as any, [
      makePreparedFinding({ category: 'secrets', secretValue: 'sk-live-123' }),
    ], []);

    const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
    expect(decoded.findings[0].secret_value).toBe('sk-live-123');
  });

  it('does NOT query the DB for findings (plan-driven, not DB-driven)', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    await prepareTriageInput(makeCtx() as any, [makePreparedFinding()], []);

    // Only baseline assessments go through the DB (db.execute) — no
    // select/from/where on the findings table.
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.innerJoin).not.toHaveBeenCalled();
  });

  it('enriches trufflehog findings with verified/detector metadata from result files', async () => {
    const trufflehogContent = JSON.stringify({
      SourceMetadata: { Data: { Filesystem: { file: 'src/config.ts' } } },
      Verified: true,
      DetectorName: 'AWS',
    });
    const resultFiles = [{
      key: 'trufflehog',
      filename: 'trufflehog-results.json',
      scanType: 'Trufflehog Scan',
      testTitle: '',
      content_b64: Buffer.from(trufflehogContent).toString('base64'),
    }];

    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx() as any, [
      makePreparedFinding({ tool: 'trufflehog', filePath: 'src/config.ts' }),
    ], resultFiles);

    const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
    expect(decoded.findings[0].verified).toBe(true);
    expect(decoded.findings[0].detector).toBe('AWS');
  });

  it('includes email_aliases when provided', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx() as any, [makePreparedFinding()], [], {
      'dev@a.com': ['dev@b.com'],
    });

    const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
    expect(decoded.email_aliases).toEqual({ 'dev@a.com': ['dev@b.com'] });
  });

  it('includes a compact existing_ai_findings section when semantic candidates are provided', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx() as any, [makePreparedFinding()], [], undefined, [
      { id: 700, title: 'SQL injection in user query builder', filePath: 'src/db.ts', severity: 'High', description: 'x'.repeat(400) },
      { id: 701, title: 'Missing auth on admin route', filePath: null, severity: 'Critical', description: null },
    ]);

    const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
    expect(decoded.existing_ai_findings).toHaveLength(2);
    expect(decoded.existing_ai_findings[0]).toEqual({
      id: 700,
      title: 'SQL injection in user query builder',
      file_path: 'src/db.ts',
      severity: 'High',
      description: 'x'.repeat(300), // truncated to keep the prompt compact
    });
    expect(decoded.existing_ai_findings[1]).toEqual({
      id: 701,
      title: 'Missing auth on admin route',
      file_path: '',
      severity: 'Critical',
      description: '',
    });
  });

  it('omits existing_ai_findings when no candidates are provided', async () => {
    const { prepareTriageInput } = await import('./triage-report.ts');
    const withEmpty = await prepareTriageInput(makeCtx() as any, [makePreparedFinding()], [], undefined, []);
    const withUndefined = await prepareTriageInput(makeCtx() as any, [makePreparedFinding()], []);

    for (const result of [withEmpty, withUndefined]) {
      const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
      expect(decoded.existing_ai_findings).toBeUndefined();
    }
  });
});

// ── runTriageAndReport ─────────────────────────────────────────────

describe('runTriageAndReport', () => {
  it('reads output files from shared volume after Claude runs', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[{"finding_id":1,"action":"risk_accept","reason":"test"}]}')  // triage-output.json
      .mockResolvedValueOnce('# Security Report')  // final-report.md
      .mockResolvedValueOnce('[{"email":"dev@test.com"}]');  // contributor-assessments.json

    const { runTriageAndReport } = await import('./triage-report.ts');
    const result = await runTriageAndReport(makeCtx() as any, null);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].finding_id).toBe(1);
    expect(result.reportContent).toBe('# Security Report');
    expect(result.devAssessments).toEqual([{ email: 'dev@test.com' }]);
    // ai-trace helper writes the Claude prompt to a tmp file; that's the only
    // sshWriteFile call we expect when no findingsB64 is provided.
    expect(mockSshWriteFile).toHaveBeenCalledTimes(1);
    const promptCall = mockSshWriteFile.mock.calls[0];
    expect(promptCall[1]).toMatch(/^\/tmp\/claude-prompt-/);
  });

  it('writes triage input via sshWriteFile when findingsB64 is provided', async () => {
    const findingsB64 = Buffer.from(JSON.stringify({ findings: [] })).toString('base64');
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')  // triage-output.json
      .mockResolvedValueOnce('# Report')          // final-report.md (must be non-empty)
      .mockResolvedValueOnce('[]');               // contributor-assessments.json

    const { runTriageAndReport } = await import('./triage-report.ts');
    await runTriageAndReport(makeCtx() as any, findingsB64);

    // Two sshWriteFile calls: the findings input (b64-decoded JSON) plus the
    // Claude prompt tmp file from the ai-trace helper.
    expect(mockSshWriteFile).toHaveBeenCalledTimes(2);
    const paths = mockSshWriteFile.mock.calls.map(c => c[1]);
    expect(paths.some((p: unknown) => typeof p === 'string' && p.endsWith('/triage-input.json'))).toBe(true);
    expect(paths.some((p: unknown) => typeof p === 'string' && p.startsWith('/tmp/claude-prompt-'))).toBe(true);
    // Exactly one claude invocation (ai-trace also issues an `rm -f` tmp-file cleanup call)
    const claudeCalls = mockSshExec.mock.calls.filter(c => String(c[1]).includes('| claude '));
    expect(claudeCalls).toHaveLength(1);
  });

  it('threads ctx.cancelSignal into the triage-input sshWriteFile', async () => {
    const findingsB64 = Buffer.from(JSON.stringify({ findings: [] })).toString('base64');
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[]');
    const controller = new AbortController();

    const { runTriageAndReport } = await import('./triage-report.ts');
    await runTriageAndReport(makeCtx({ cancelSignal: controller.signal }) as any, findingsB64);

    const inputCall = mockSshWriteFile.mock.calls
      .find(c => typeof c[1] === 'string' && (c[1] as string).endsWith('/triage-input.json'));
    expect(inputCall).toBeDefined();
    expect(inputCall![3]).toBe(controller.signal);
  });

  it('includes language instruction in prompt for non-English', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockSshWriteFile.mockResolvedValue(undefined);
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    await runTriageAndReport(makeCtx({ reportLanguage: 'uk' }) as any, null);

    // Prompt is no longer embedded in the shell command — the ai-trace helper
    // writes it to a tmp file via sshWriteFile and then `cat`s it into claude.
    const promptCalls = mockSshWriteFile.mock.calls
      .filter(c => typeof c[1] === 'string' && (c[1] as string).startsWith('/tmp/claude-prompt-'));
    expect(promptCalls.length).toBeGreaterThan(0);
    expect(promptCalls[0][2]).toContain('Українською');
  });

  it('reads contributor-assessments.json from toolsDir (not agentDir)', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[{"email":"dev@test.com","security":7}]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    const ctx = makeCtx({ toolsDir: '/scan/tools_results', agentDir: '/scan/agent_files' });
    const result = await runTriageAndReport(ctx as any, null);

    // assessments file must be read from toolsDir, where the triage agent writes it
    // (3rd read now that the profile read is gone: triage-output, final-report, assessments)
    const assessmentReadCall = mockReadFile.mock.calls[2];
    expect(assessmentReadCall[0]).toBe('/scan/tools_results/contributor-assessments.json');
    expect(result.devAssessments).toEqual([{ email: 'dev@test.com', security: 7 }]);
  });

  it('parses contributor_email and contributor_name from triage decisions', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({
        decisions: [
          { finding_id: 1, action: 'keep', reason: 'Real vuln', contributor_email: 'dev@test.com', contributor_name: 'Dev User' },
          { finding_id: 2, action: 'risk_accept', reason: 'False positive' },
        ],
      }))
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    const result = await runTriageAndReport(makeCtx() as any, null);

    expect(result.decisions[0].contributor_email).toBe('dev@test.com');
    expect(result.decisions[0].contributor_name).toBe('Dev User');
    expect(result.decisions[1].contributor_email).toBeUndefined();
  });

  it('returns empty defaults when optional files are missing (no findings)', async () => {
    // With NO findings, a missing triage-output.json is legitimate (nothing to
    // decide) and a missing contributor-assessments.json is optional — but
    // final-report.md must always exist after a successful AI run.
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT'))   // triage-output.json
      .mockResolvedValueOnce('# Report')            // final-report.md
      .mockRejectedValueOnce(new Error('ENOENT'));  // contributor-assessments.json

    const { runTriageAndReport } = await import('./triage-report.ts');
    const result = await runTriageAndReport(makeCtx() as any, null);

    expect(result.decisions).toEqual([]);
    expect(result.devAssessments).toEqual([]);
  });

  it('throws when final-report.md is missing even with no findings', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const { runTriageAndReport } = await import('./triage-report.ts');
    await expect(runTriageAndReport(makeCtx() as any, null))
      .rejects.toThrow(/Triage output incomplete: final-report\.md missing/);
  });

  it('includes --model flag resolved from ctx.aiModelTriage', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    await runTriageAndReport(makeCtx({ aiModelTriage: 'sonnet' }) as any, null);

    const command = mockSshExec.mock.calls[0][1];
    expect(command).toContain('--model claude-sonnet-5[1m]');
  });
});

// ── runTriageStep ──────────────────────────────────────────────────
// The step must NOT write repo data: decisions + assessment enhancements are
// returned in the step output (resume-safe) and applied by the commit step.

describe('runTriageStep', () => {
  const basePrev = {
    aiAvailable: true,
    repositoryId: 42,
    workspaceId: 10,
    resultFiles: [],
    preparedFindings: [makePreparedFinding({ tempId: 1 }), makePreparedFinding({ tempId: 2, fingerprint: 'fp-2' })],
  };

  // Helper: set up mocks for a full successful run with given decisions/assessments
  function setupTriageRun(opts: {
    decisions?: unknown[];
    reportContent?: string;
    devAssessments?: unknown[];
  } = {}) {
    const {
      decisions = [],
      reportContent = '# Report',
      devAssessments = [],
    } = opts;

    // runTriageAndReport: SSH exec succeeds
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockSshWriteFile.mockResolvedValue(undefined);

    // runTriageAndReport: file reads (triage-output, final-report, assessments).
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ decisions }))
      .mockResolvedValueOnce(reportContent)
      .mockResolvedValueOnce(JSON.stringify(devAssessments));

    // storeReports succeeds
    mockStoreReports.mockResolvedValueOnce(undefined);
  }

  it('returns zeros with empty decisions when prev.aiAvailable is false', async () => {
    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({
      ctx: makeCtx() as any,
      prev: { aiAvailable: false, repositoryId: 42, workspaceId: 10, resultFiles: [] },
    });

    expect(result).toEqual({
      triaged: 0,
      dismissed: 0,
      kept: 0,
      reportsGenerated: false,
      assessmentsEnhanced: 0,
      durationMs: 0,
      decisions: [],
      devAssessments: [],
      skipped: true,
      skipReason: 'analysis-failed',
    });
    // Should not call any sub-functions
    expect(mockSshExec).not.toHaveBeenCalled();
    expect(mockStoreReports).not.toHaveBeenCalled();
  });

  it('returns zeros with an EXPLICIT skipReason when AI triage is disabled (no bare zeroes)', async () => {
    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({
      ctx: makeCtx({ aiTriageEnabled: false }) as any,
      prev: basePrev,
    });

    expect(result.decisions).toEqual([]);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('ai-triage-disabled');
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('does NOT set skipped/skipReason on a successful triage run', async () => {
    setupTriageRun({ decisions: [{ finding_id: 1, action: 'keep', reason: 'Real' }] });

    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({ ctx: makeCtx() as any, prev: basePrev });

    expect(result.skipped).toBeUndefined();
    expect(result.skipReason).toBeUndefined();
    expect(result.triaged).toBe(1);
  });

  it('runs the triage agent on the prepared plan and returns decisions in the output', async () => {
    setupTriageRun({
      decisions: [
        { finding_id: 1, action: 'keep', reason: 'Real issue' },
        { finding_id: 2, action: 'false_positive', reason: 'Not real' },
      ],
    });

    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({ ctx: makeCtx() as any, prev: basePrev });

    // runTriageAndReport was called (one claude invocation; ai-trace adds an `rm -f` cleanup call)
    const claudeCalls = mockSshExec.mock.calls.filter(c => String(c[1]).includes('| claude '));
    expect(claudeCalls).toHaveLength(1);

    expect(result.triaged).toBe(2);
    expect(result.dismissed).toBe(1); // planned — applied at commit
    expect(result.kept).toBe(1);
    expect(result.reportsGenerated).toBe(true);
    expect(result.decisions).toEqual([
      { finding_id: 1, action: 'keep', reason: 'Real issue' },
      { finding_id: 2, action: 'false_positive', reason: 'Not real' },
    ]);
  });

  it('does NOT write findings/assessments to the DB (decisions applied at commit)', async () => {
    setupTriageRun({
      decisions: [
        { finding_id: 1, action: 'false_positive', reason: 'Not real', contributor_email: 'dev@test.com' },
        { finding_id: 2, action: 'keep', reason: 'Valid', contributor_email: 'dev@test.com' },
      ],
      devAssessments: [{ contributor_email: 'dev@test.com', feedback: '### Security Findings\nTest' }],
    });

    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({ ctx: makeCtx() as any, prev: basePrev });

    // No finding status updates, no attribution, no assessment rows here
    expect(mockDb.update).not.toHaveBeenCalled();
    // The devAssessments are carried in the output for the commit step
    expect(result.devAssessments).toEqual([{ contributor_email: 'dev@test.com', feedback: '### Security Findings\nTest' }]);
    expect(result.assessmentsEnhanced).toBe(1);
  });

  it('builds the triage prompt from the prepared plan (temp ids)', async () => {
    setupTriageRun({ decisions: [] });

    const { runTriageStep } = await import('./triage-report.ts');
    await runTriageStep({ ctx: makeCtx() as any, prev: basePrev });

    // The triage input file contains the prepared findings keyed by temp ids
    const inputCall = mockSshWriteFile.mock.calls.find(
      c => typeof c[1] === 'string' && (c[1] as string).endsWith('/triage-input.json'),
    );
    expect(inputCall).toBeDefined();
    const payload = JSON.parse(String(inputCall![2]));
    expect(payload.findings.map((f: any) => f.id)).toEqual([1, 2]);
  });

  it('skips the AI run entirely when the plan has no findings (input NONE)', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockSshWriteFile.mockResolvedValue(undefined);
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT'))   // triage-output.json — legit with no findings
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[]');
    mockStoreReports.mockResolvedValueOnce(undefined);

    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({
      ctx: makeCtx() as any,
      prev: { ...basePrev, preparedFindings: [] },
    });

    // No triage-input.json written — only the prompt tmp file
    const inputCalls = mockSshWriteFile.mock.calls.filter(
      c => typeof c[1] === 'string' && (c[1] as string).endsWith('/triage-input.json'),
    );
    expect(inputCalls).toHaveLength(0);
    expect(result.triaged).toBe(0);
    expect(result.reportsGenerated).toBe(true);
  });

  it('stores reports via storeReports (scan_files diagnostics)', async () => {
    setupTriageRun({ reportContent: '# Security Report' });

    const { runTriageStep } = await import('./triage-report.ts');
    await runTriageStep({ ctx: makeCtx() as any, prev: basePrev });

    expect(mockStoreReports).toHaveBeenCalledWith('scan-1', '# Security Report');
  });

  it('returns correct TriageReportOutput shape', async () => {
    setupTriageRun({
      decisions: [
        { finding_id: 1, action: 'keep', reason: 'Valid' },
        { finding_id: 2, action: 'risk_accept', reason: 'OK' },
        { finding_id: 3, action: 'false_positive', reason: 'FP' },
        { finding_id: 4, action: 'keep', reason: 'Also valid' },
      ],
      devAssessments: [{ email: 'a@b.com' }, { email: 'c@d.com' }],
    });

    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({ ctx: makeCtx() as any, prev: basePrev });

    expect(result.triaged).toBe(4);
    expect(result.dismissed).toBe(2);
    expect(result.kept).toBe(2);
    expect(result.reportsGenerated).toBe(true);
    expect(result.assessmentsEnhanced).toBe(2);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.decisions).toHaveLength(4);
    expect(result.devAssessments).toHaveLength(2);
  });

  it('defaults preparedFindings/resultFiles to empty when not in prev', async () => {
    const prevWithout = { aiAvailable: true, repositoryId: 42, workspaceId: 10 };

    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockSshWriteFile.mockResolvedValue(undefined);
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT'))   // no findings → no triage-output.json
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[]');
    mockStoreReports.mockResolvedValueOnce(undefined);

    const { runTriageStep } = await import('./triage-report.ts');
    // Should not throw — plan defaults to [] and the run completes
    const result = await runTriageStep({ ctx: makeCtx() as any, prev: prevWithout });
    expect(result.reportsGenerated).toBe(true);
  });

  // ── Semantic cross-scan matching (AI findings) ───────────────────
  // AI findings never fingerprint-match across scans (titles rephrased every
  // run) — the triage agent matches them semantically against the repo's
  // existing AI findings and returns `same_as: <dbId>` decisions.

  describe('semantic cross-scan matching', () => {
    const beastPrev = {
      aiAvailable: true,
      repositoryId: 42,
      workspaceId: 10,
      resultFiles: [],
      preparedFindings: [
        makePreparedFinding({ tempId: 1, tool: 'beast', testKey: 'code-analysis', title: 'SQLi in query builder' }),
        makePreparedFinding({ tempId: 2, tool: 'gitleaks', fingerprint: 'fp-2' }),
      ],
    };
    const candidateRow = { id: 700, title: 'SQL injection in query builder', filePath: 'src/db.ts', severity: 'High', description: 'old desc' };

    function triageInputPayload() {
      const inputCall = mockSshWriteFile.mock.calls.find(
        c => typeof c[1] === 'string' && (c[1] as string).endsWith('/triage-input.json'),
      );
      expect(inputCall).toBeDefined();
      return JSON.parse(String(inputCall![2]));
    }

    function warningEventMessages(): string[] {
      return mockDb.values.mock.calls
        .filter((c: any[]) => c[0]?.level === 'warning')
        .map((c: any[]) => String(c[0]?.message ?? ''));
    }

    it('queries existing AI candidates and includes them in the triage input when the plan has beast findings', async () => {
      mockDb.limit.mockResolvedValueOnce([candidateRow]);
      setupTriageRun();

      const { runTriageStep } = await import('./triage-report.ts');
      await runTriageStep({ ctx: makeCtx() as any, prev: beastPrev });

      expect(mockDb.select).toHaveBeenCalled();
      const payload = triageInputPayload();
      expect(payload.existing_ai_findings).toEqual([{
        id: 700,
        title: 'SQL injection in query builder',
        file_path: 'src/db.ts',
        severity: 'High',
        description: 'old desc',
      }]);
    });

    it('does NOT query candidates when the plan has no AI (beast) findings', async () => {
      setupTriageRun();

      const { runTriageStep } = await import('./triage-report.ts');
      await runTriageStep({ ctx: makeCtx() as any, prev: basePrev });

      // fetchBaselineAssessments uses db.execute — the only select chain here
      // would be the candidates query, and it must not run.
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(triageInputPayload().existing_ai_findings).toBeUndefined();
    });

    it('passes a VALID same_as decision through to the step output', async () => {
      mockDb.limit.mockResolvedValueOnce([candidateRow]);
      setupTriageRun({
        decisions: [{ finding_id: 1, action: 'keep', reason: 'Still real', same_as: 700 }],
      });

      const { runTriageStep } = await import('./triage-report.ts');
      const result = await runTriageStep({ ctx: makeCtx() as any, prev: beastPrev });

      expect(result.decisions[0].same_as).toBe(700);
      expect(warningEventMessages()).toEqual([]);
    });

    it('strips same_as pointing outside the candidate set (warn + treat as new)', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockDb.limit.mockResolvedValueOnce([candidateRow]);
        setupTriageRun({
          decisions: [{ finding_id: 1, action: 'keep', reason: 'Real', same_as: 999 }],
        });

        const { runTriageStep } = await import('./triage-report.ts');
        const result = await runTriageStep({ ctx: makeCtx() as any, prev: beastPrev });

        expect(result.decisions[0].same_as).toBeUndefined();
        expect(warningEventMessages().join('\n')).toContain('Ignoring invalid semantic match');
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });

    it('strips a non-integer same_as (warn + treat as new)', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockDb.limit.mockResolvedValueOnce([candidateRow]);
        setupTriageRun({
          decisions: [{ finding_id: 1, action: 'keep', reason: 'Real', same_as: '700' }],
        });

        const { runTriageStep } = await import('./triage-report.ts');
        const result = await runTriageStep({ ctx: makeCtx() as any, prev: beastPrev });

        expect(result.decisions[0].same_as).toBeUndefined();
        expect(warningEventMessages().join('\n')).toContain('not an integer');
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });

    it('strips same_as on a non-AI finding — only beast findings are eligible sources', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockDb.limit.mockResolvedValueOnce([candidateRow]);
        setupTriageRun({
          decisions: [
            { finding_id: 2, action: 'keep', reason: 'Real', same_as: 700 }, // tempId 2 is gitleaks
          ],
        });

        const { runTriageStep } = await import('./triage-report.ts');
        const result = await runTriageStep({ ctx: makeCtx() as any, prev: beastPrev });

        expect(result.decisions[0].same_as).toBeUndefined();
        expect(warningEventMessages().join('\n')).toContain("not an AI ('beast') finding");
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });
  });
});

// ── AI output anomaly detection ─────────────────────────────────────

describe('runTriageAndReport AI output anomalies', () => {
  const findingsB64 = Buffer.from(JSON.stringify({ findings: [{ id: 1 }] })).toString('base64');

  function scanEventMessages(): string[] {
    return mockDb.values.mock.calls.map((c: any[]) => String(c[0]?.message ?? ''));
  }

  it('records an error scan event and throws when triage-output.json is missing after a successful AI run with findings', async () => {
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const { runTriageAndReport } = await import('./triage-report.ts');
    await expect(runTriageAndReport(makeCtx() as any, findingsB64))
      .rejects.toThrow(/Triage output incomplete: .*triage-output\.json/);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      level: 'error',
      source: 'triage-report',
      message: expect.stringContaining('triage-output.json'),
    }));
  });

  it('does NOT flag a missing triage-output.json when there were no findings to triage', async () => {
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT'))   // triage-output.json
      .mockResolvedValueOnce('# Report')            // final-report.md
      .mockResolvedValueOnce('[]');                 // assessments

    const { runTriageAndReport } = await import('./triage-report.ts');
    const result = await runTriageAndReport(makeCtx() as any, null);

    expect(scanEventMessages().join('\n')).not.toContain('triage-output.json');
    expect(result.anomalies).toEqual([]);
  });

  it('records an error scan event and throws when triage-output.json is corrupt JSON', async () => {
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[{"finding_id":')  // truncated
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    // Snippet of the corrupt content is included for diagnosis
    await expect(runTriageAndReport(makeCtx() as any, findingsB64))
      .rejects.toThrow('Triage output incomplete: Failed to parse triage-output.json');

    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      source: 'triage-report',
      message: expect.stringContaining('{"decisions":[{"finding_id":'),
    }));
  });

  it('records an error scan event and throws when contributor-assessments.json is corrupt JSON', async () => {
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[{"email": corrupt');

    const { runTriageAndReport } = await import('./triage-report.ts');
    await expect(runTriageAndReport(makeCtx() as any, findingsB64))
      .rejects.toThrow(/Triage output incomplete: .*contributor-assessments\.json/);

    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      source: 'triage-report',
      message: expect.stringContaining('contributor-assessments.json'),
    }));
  });

  it('records an error scan event and throws when final-report.md is missing/empty after a successful run', async () => {
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('')     // empty report
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    await expect(runTriageAndReport(makeCtx() as any, findingsB64))
      .rejects.toThrow(/Triage output incomplete: .*final-report\.md/);

    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      source: 'triage-report',
      message: expect.stringContaining('final-report.md'),
    }));
  });

  it('reports no anomalies on a fully successful run', async () => {
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[{"finding_id":1,"action":"keep","reason":"r"}]}')
      .mockResolvedValueOnce('# Report')
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    const result = await runTriageAndReport(makeCtx() as any, findingsB64);

    expect(result.anomalies).toEqual([]);
    expect(result.decisions).toHaveLength(1);
  });
});
