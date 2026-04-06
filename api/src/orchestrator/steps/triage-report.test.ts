import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/index.ts';

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
const mockRiskAcceptFinding = vi.fn();
const mockFalsePositiveFinding = vi.fn();
const mockDuplicateFinding = vi.fn();
const mockAddFindingNote = vi.fn();
const mockAddScanFile = vi.fn();

vi.mock('../entities.ts', () => ({
  riskAcceptFinding: (...args: unknown[]) => mockRiskAcceptFinding(...args),
  falsePositiveFinding: (...args: unknown[]) => mockFalsePositiveFinding(...args),
  duplicateFinding: (...args: unknown[]) => mockDuplicateFinding(...args),
  addFindingNote: (...args: unknown[]) => mockAddFindingNote(...args),
  addScanFile: (...args: unknown[]) => mockAddScanFile(...args),
}));

// ── Mock contributors ──────────────────────────────────────────────
const mockFindOrCreateContributor = vi.fn();

vi.mock('../../routes/contributors.ts', () => ({
  findOrCreateContributor: (...args: unknown[]) => mockFindOrCreateContributor(...args),
}));

// ── Mock finalize (storeReports, ingestContributorStats) ───────────
const mockStoreReports = vi.fn();
const mockIngestContributorStats = vi.fn();

vi.mock('./finalize.ts', () => ({
  storeReports: (...args: unknown[]) => mockStoreReports(...args),
  ingestContributorStats: (...args: unknown[]) => mockIngestContributorStats(...args),
}));

vi.mock('../prompt-languages.ts', () => ({
  getLanguageInstruction: (lang: string) => lang === 'uk' ? 'Пиши Українською.' : '',
}));

beforeEach(() => {
  mockSshExec.mockReset();
  mockSshWriteFile.mockReset();
  mockReadFile.mockReset();
  mockRiskAcceptFinding.mockReset();
  mockFalsePositiveFinding.mockReset();
  mockDuplicateFinding.mockReset();
  mockAddFindingNote.mockReset();
  mockAddScanFile.mockReset();
  mockFindOrCreateContributor.mockReset();
  mockStoreReports.mockReset();
  mockIngestContributorStats.mockReset();
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

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

  it('exports applyTriageDecisions as a function', async () => {
    const mod = await import('./triage-report.ts');
    expect(typeof mod.applyTriageDecisions).toBe('function');
  });

  it('exports runTriageStep as a function', async () => {
    const mod = await import('./triage-report.ts');
    expect(typeof mod.runTriageStep).toBe('function');
  });
});

// ── prepareTriageInput ─────────────────────────────────────────────

describe('prepareTriageInput', () => {
  const makeCtx = (overrides = {}) => ({
    scanId: 'scan-1',
    repoUrl: 'https://example.com/repo',
    repoName: 'test-repo',
    branch: 'main',
    commitHash: 'abc123',
    localPath: '',
    teamName: 'team1',
    workspaceName: 'ws1',
    workspaceId: 10,
    workDir: '/tmp',
    repoPath: '/tmp/repo',
    toolsDir: '/tmp/results',
    agentDir: '/tmp',
    resultsDir: '/tmp/results',
    profilePath: '/tmp/profile.md',
    cloneUrl: 'https://example.com/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    ...overrides,
  });

  it('returns null when no active findings exist', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx(), 10, []);

    expect(result).toBeNull();
  });

  it('returns a base64-encoded JSON string when findings exist', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 1,
        title: 'Secret found',
        severity: 'High',
        description: 'A secret was detected',
        filePath: 'src/config.ts',
        line: 42,
        tool: 'gitleaks',
        vulnIdFromTool: 'generic-api-key',
        testTool: 'gitleaks',
        status: 'open',
      },
    ]);

    const { prepareTriageInput } = await import('./triage-report.ts');
    const result = await prepareTriageInput(makeCtx(), 10, []);

    expect(result).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(result!, 'base64').toString('utf8'));
    expect(decoded.repo_name).toBe('test-repo');
    expect(decoded.findings).toHaveLength(1);
    expect(decoded.findings[0].id).toBe(1);
    expect(decoded.findings[0].tool).toBe('gitleaks');
  });

  it('queries findings via Drizzle select with join', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const { prepareTriageInput } = await import('./triage-report.ts');
    await prepareTriageInput(makeCtx(), 42, []);

    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.from).toHaveBeenCalled();
    expect(mockDb.innerJoin).toHaveBeenCalled();
    expect(mockDb.where).toHaveBeenCalled();
    expect(mockDb.orderBy).toHaveBeenCalled();
  });
});

// ── applyTriageDecisions ───────────────────────────────────────────

describe('applyTriageDecisions', () => {
  it('applies risk_accept decisions', async () => {
    mockRiskAcceptFinding.mockResolvedValue({ id: 1, status: 'risk_accepted' });
    mockAddFindingNote.mockResolvedValue({ id: 1 });

    const { applyTriageDecisions } = await import('./triage-report.ts');
    const dismissed = await applyTriageDecisions([
      { finding_id: 1, action: 'risk_accept', reason: 'Known risk' },
    ]);

    expect(dismissed).toBe(1);
    expect(mockRiskAcceptFinding).toHaveBeenCalledWith(1, 'Known risk');
    expect(mockAddFindingNote).toHaveBeenCalledWith({
      findingId: 1,
      author: 'beast-triage',
      noteType: 'triage',
      content: '[Auto-Triage] Risk accepted: Known risk',
    });
  });

  it('applies false_positive decisions', async () => {
    mockFalsePositiveFinding.mockResolvedValue({ id: 2, status: 'false_positive' });
    mockAddFindingNote.mockResolvedValue({ id: 1 });

    const { applyTriageDecisions } = await import('./triage-report.ts');
    const dismissed = await applyTriageDecisions([
      { finding_id: 2, action: 'false_positive', reason: 'ORM prevents injection' },
    ]);

    expect(dismissed).toBe(1);
    expect(mockFalsePositiveFinding).toHaveBeenCalledWith(2, 'ORM prevents injection');
    expect(mockAddFindingNote).toHaveBeenCalledWith({
      findingId: 2,
      author: 'beast-triage',
      noteType: 'triage',
      content: '[Auto-Triage] False positive: ORM prevents injection',
    });
  });

  it('applies duplicate decisions', async () => {
    mockDuplicateFinding.mockResolvedValue({ id: 3, status: 'duplicate' });
    mockAddFindingNote.mockResolvedValue({ id: 1 });

    const { applyTriageDecisions } = await import('./triage-report.ts');
    const dismissed = await applyTriageDecisions([
      { finding_id: 3, action: 'duplicate', reason: 'Same as finding #1' },
    ]);

    expect(dismissed).toBe(1);
    expect(mockDuplicateFinding).toHaveBeenCalledWith(3, 'Same as finding #1');
    expect(mockAddFindingNote).toHaveBeenCalledWith({
      findingId: 3,
      author: 'beast-triage',
      noteType: 'triage',
      content: '[Auto-Triage] Duplicate: Same as finding #1',
    });
  });

  it('handles mixed decisions and skips keep', async () => {
    mockRiskAcceptFinding.mockResolvedValue({ id: 1 });
    mockFalsePositiveFinding.mockResolvedValue({ id: 2 });
    mockDuplicateFinding.mockResolvedValue({ id: 3 });
    mockAddFindingNote.mockResolvedValue({ id: 1 });

    const { applyTriageDecisions } = await import('./triage-report.ts');
    const dismissed = await applyTriageDecisions([
      { finding_id: 1, action: 'risk_accept', reason: 'Acceptable' },
      { finding_id: 2, action: 'false_positive', reason: 'Not real' },
      { finding_id: 3, action: 'duplicate', reason: 'Dupe of #1' },
      { finding_id: 4, action: 'keep', reason: 'Valid finding' },
    ]);

    expect(dismissed).toBe(3);
    expect(mockRiskAcceptFinding).toHaveBeenCalledTimes(1);
    expect(mockFalsePositiveFinding).toHaveBeenCalledTimes(1);
    expect(mockDuplicateFinding).toHaveBeenCalledTimes(1);
  });

  it('returns 0 for empty decisions', async () => {
    const { applyTriageDecisions } = await import('./triage-report.ts');
    const dismissed = await applyTriageDecisions([]);

    expect(dismissed).toBe(0);
  });

  it('ignores individual failures and continues processing', async () => {
    mockRiskAcceptFinding
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({ id: 2 });
    mockAddFindingNote.mockResolvedValue({ id: 1 });

    const { applyTriageDecisions } = await import('./triage-report.ts');
    const dismissed = await applyTriageDecisions([
      { finding_id: 1, action: 'risk_accept', reason: 'Fail' },
      { finding_id: 2, action: 'risk_accept', reason: 'Success' },
    ]);

    expect(dismissed).toBe(1);
  });
});

// ── runTriageAndReport ─────────────────────────────────────────────

describe('runTriageAndReport', () => {
  const makeCtx = (overrides = {}) => ({
    scanId: 'scan-1',
    repoUrl: 'https://example.com/repo',
    repoName: 'test-repo',
    branch: 'main',
    commitHash: 'abc',
    localPath: '',
    teamName: 'team1',
    workspaceName: 'ws1',
    workspaceId: 10,
    workDir: '/tmp',
    repoPath: '/tmp/repo',
    toolsDir: '/tmp/results',
    agentDir: '/tmp',
    resultsDir: '/tmp/results',
    profilePath: '/tmp/profile.md',
    cloneUrl: 'https://example.com/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    ...overrides,
  });

  it('reads output files from shared volume after Claude runs', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[{"finding_id":1,"action":"risk_accept","reason":"test"}]}')  // triage-output.json
      .mockResolvedValueOnce('# Security Report')  // final-report.md
      .mockResolvedValueOnce('# Repo Profile')  // profile.md
      .mockResolvedValueOnce('[{"email":"dev@test.com"}]');  // contributor-assessments.json

    const { runTriageAndReport } = await import('./triage-report.ts');
    const result = await runTriageAndReport(makeCtx(), null);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].finding_id).toBe(1);
    expect(result.reportContent).toBe('# Security Report');
    expect(result.profileContent).toBe('# Repo Profile');
    expect(result.devAssessments).toEqual([{ email: 'dev@test.com' }]);
    expect(mockSshWriteFile).not.toHaveBeenCalled();
  });

  it('writes triage input via sshWriteFile when findingsB64 is provided', async () => {
    const findingsB64 = Buffer.from(JSON.stringify({ findings: [] })).toString('base64');
    mockSshWriteFile.mockResolvedValueOnce(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    await runTriageAndReport(makeCtx(), findingsB64);

    expect(mockSshWriteFile).toHaveBeenCalledTimes(1);
    expect(mockSshExec).toHaveBeenCalledTimes(1);
  });

  it('includes language instruction in prompt for non-English', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    await runTriageAndReport(makeCtx({ reportLanguage: 'uk' }), null);

    const command = mockSshExec.mock.calls[0][1];
    expect(command).toContain('Українською');
  });

  it('reads contributor-assessments.json from toolsDir (not agentDir)', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('[{"email":"dev@test.com","security":7}]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    const ctx = makeCtx({ toolsDir: '/scan/tools_results', agentDir: '/scan/agent_files' });
    const result = await runTriageAndReport(ctx, null);

    // assessments file must be read from toolsDir, where the triage agent writes it
    const assessmentReadCall = mockReadFile.mock.calls[3];
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
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('[]');

    const { runTriageAndReport } = await import('./triage-report.ts');
    const result = await runTriageAndReport(makeCtx(), null);

    expect(result.decisions[0].contributor_email).toBe('dev@test.com');
    expect(result.decisions[0].contributor_name).toBe('Dev User');
    expect(result.decisions[1].contributor_email).toBeUndefined();
  });

  it('returns empty defaults when files are missing', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const { runTriageAndReport } = await import('./triage-report.ts');
    const result = await runTriageAndReport(makeCtx(), null);

    expect(result.decisions).toEqual([]);
    expect(result.reportContent).toBe('');
    expect(result.profileContent).toBe('');
    expect(result.devAssessments).toEqual([]);
  });
});

// ── runTriageStep ──────────────────────────────────────────────────

describe('runTriageStep', () => {
  const makeCtx = (overrides = {}) => ({
    scanId: 'scan-1',
    repoUrl: 'https://example.com/repo',
    repoName: 'test-repo',
    branch: 'main',
    commitHash: 'abc123',
    localPath: '',
    teamName: 'team1',
    workspaceName: 'ws1',
    workspaceId: 10,
    workDir: '/tmp',
    repoPath: '/tmp/repo',
    toolsDir: '/tmp/results',
    agentDir: '/tmp',
    resultsDir: '/tmp/results',
    profilePath: '/tmp/profile.md',
    cloneUrl: 'https://example.com/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    ...overrides,
  });

  const basePrev = {
    aiAvailable: true,
    repositoryId: 42,
    workspaceId: 10,
    resultFiles: [],
  };

  // Helper: set up mocks for a full successful run with given decisions/assessments
  function setupTriageRun(opts: {
    findings?: unknown[];
    decisions?: unknown[];
    reportContent?: string;
    profileContent?: string;
    devAssessments?: unknown[];
  } = {}) {
    const {
      findings = [],
      decisions = [],
      reportContent = '# Report',
      profileContent = '# Profile',
      devAssessments = [],
    } = opts;

    // prepareTriageInput: DB query returns findings
    if (findings.length > 0) {
      mockDb.orderBy.mockResolvedValueOnce(findings);
    } else {
      mockDb.orderBy.mockResolvedValueOnce([]);
    }

    // runTriageAndReport: SSH exec succeeds
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    // runTriageAndReport: file reads
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ decisions }))
      .mockResolvedValueOnce(reportContent)
      .mockResolvedValueOnce(profileContent)
      .mockResolvedValueOnce(JSON.stringify(devAssessments));

    // storeReports succeeds
    mockStoreReports.mockResolvedValueOnce(undefined);

    // ingestContributorStats succeeds
    mockIngestContributorStats.mockResolvedValueOnce(undefined);
  }

  it('returns zeros when prev.aiAvailable is false', async () => {
    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({
      ctx: makeCtx(),
      prev: { aiAvailable: false, repositoryId: 42, workspaceId: 10, resultFiles: [] },
    });

    expect(result).toEqual({
      triaged: 0,
      dismissed: 0,
      kept: 0,
      reportsGenerated: false,
      assessmentsEnhanced: 0,
      durationMs: 0,
    });
    // Should not call any sub-functions
    expect(mockSshExec).not.toHaveBeenCalled();
    expect(mockStoreReports).not.toHaveBeenCalled();
  });

  it('calls prepareTriageInput, runTriageAndReport, and applyTriageDecisions in sequence', async () => {
    setupTriageRun({
      decisions: [
        { finding_id: 1, action: 'keep', reason: 'Real issue' },
        { finding_id: 2, action: 'false_positive', reason: 'Not real' },
      ],
    });
    mockFalsePositiveFinding.mockResolvedValueOnce({ id: 2 });
    mockAddFindingNote.mockResolvedValue({ id: 1 });

    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({ ctx: makeCtx(), prev: basePrev });

    // prepareTriageInput was called (DB query)
    expect(mockDb.select).toHaveBeenCalled();
    // runTriageAndReport was called (SSH exec)
    expect(mockSshExec).toHaveBeenCalledTimes(1);
    // applyTriageDecisions was called (false_positive handler)
    expect(mockFalsePositiveFinding).toHaveBeenCalledWith(2, 'Not real');

    expect(result.triaged).toBe(2);
    expect(result.dismissed).toBe(1);
    expect(result.kept).toBe(1);
    expect(result.reportsGenerated).toBe(true);
  });

  it('attributes findings to contributors for non-risk_accept decisions with email', async () => {
    setupTriageRun({
      decisions: [
        { finding_id: 1, action: 'keep', reason: 'Valid', contributor_email: 'dev@test.com', contributor_name: 'Dev User' },
        { finding_id: 2, action: 'risk_accept', reason: 'Accepted', contributor_email: 'other@test.com' },
        { finding_id: 3, action: 'false_positive', reason: 'FP', contributor_email: 'fp@test.com' },
        { finding_id: 4, action: 'keep', reason: 'No email' },
      ],
    });
    mockFalsePositiveFinding.mockResolvedValueOnce({ id: 3 });
    mockAddFindingNote.mockResolvedValue({ id: 1 });
    mockFindOrCreateContributor.mockResolvedValue(100);

    const { runTriageStep } = await import('./triage-report.ts');
    await runTriageStep({ ctx: makeCtx(), prev: basePrev });

    // Finding 1: keep + has email -> attributed
    expect(mockFindOrCreateContributor).toHaveBeenCalledWith('dev@test.com', 'Dev User', 10);
    // Finding 2: risk_accept -> skipped even though it has email
    expect(mockFindOrCreateContributor).not.toHaveBeenCalledWith('other@test.com', expect.anything(), expect.anything());
    // Finding 3: false_positive + has email -> attributed
    expect(mockFindOrCreateContributor).toHaveBeenCalledWith('fp@test.com', 'fp', 10);
    // Finding 4: no email -> skipped
    expect(mockFindOrCreateContributor).toHaveBeenCalledTimes(2);

    // DB update for contributor attribution
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('uses email prefix as name when contributor_name is missing', async () => {
    setupTriageRun({
      decisions: [
        { finding_id: 1, action: 'keep', reason: 'Valid', contributor_email: 'john.doe@company.com' },
      ],
    });
    mockFindOrCreateContributor.mockResolvedValue(50);

    const { runTriageStep } = await import('./triage-report.ts');
    await runTriageStep({ ctx: makeCtx(), prev: basePrev });

    expect(mockFindOrCreateContributor).toHaveBeenCalledWith('john.doe@company.com', 'john.doe', 10);
  });

  it('stores reports via storeReports', async () => {
    setupTriageRun({
      reportContent: '# Security Report',
      profileContent: '# Repo Profile',
    });

    const { runTriageStep } = await import('./triage-report.ts');
    await runTriageStep({ ctx: makeCtx(), prev: basePrev });

    expect(mockStoreReports).toHaveBeenCalledWith('scan-1', '# Security Report', '# Repo Profile');
  });

  it('appends security findings to assessments when devAssessments are present', async () => {
    const assessments = [{ contributor_email: 'dev@test.com', feedback: '### Security Findings\nTest' }];
    setupTriageRun({ devAssessments: assessments });
    mockFindOrCreateContributor.mockResolvedValue(50);
    // Mock db.select for finding existing assessment
    mockDb.limit?.mockResolvedValueOnce?.([]);

    const { runTriageStep } = await import('./triage-report.ts');
    await runTriageStep({ ctx: makeCtx(), prev: basePrev });

    // Should attempt to find/create contributor for the assessment
    expect(mockFindOrCreateContributor).toHaveBeenCalled();
  });

  it('skips ingestContributorStats when devAssessments is empty', async () => {
    setupTriageRun({ devAssessments: [] });

    const { runTriageStep } = await import('./triage-report.ts');
    await runTriageStep({ ctx: makeCtx(), prev: basePrev });

    expect(mockIngestContributorStats).not.toHaveBeenCalled();
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
    mockRiskAcceptFinding.mockResolvedValueOnce({ id: 2 });
    mockFalsePositiveFinding.mockResolvedValueOnce({ id: 3 });
    mockAddFindingNote.mockResolvedValue({ id: 1 });

    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({ ctx: makeCtx(), prev: basePrev });

    expect(result.triaged).toBe(4);
    expect(result.dismissed).toBe(2);
    expect(result.kept).toBe(2);
    expect(result.reportsGenerated).toBe(true);
    expect(result.assessmentsEnhanced).toBe(2);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('continues even when contributor attribution fails', async () => {
    setupTriageRun({
      decisions: [
        { finding_id: 1, action: 'keep', reason: 'Valid', contributor_email: 'fail@test.com' },
        { finding_id: 2, action: 'keep', reason: 'Also valid', contributor_email: 'ok@test.com' },
      ],
    });
    mockFindOrCreateContributor
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce(200);

    const { runTriageStep } = await import('./triage-report.ts');
    const result = await runTriageStep({ ctx: makeCtx(), prev: basePrev });

    // Should still complete and return results
    expect(result.triaged).toBe(2);
    expect(result.kept).toBe(2);
    expect(result.reportsGenerated).toBe(true);
    // Second attribution should still have been attempted
    expect(mockFindOrCreateContributor).toHaveBeenCalledTimes(2);
  });

  it('defaults resultFiles to empty array when not in prev', async () => {
    // No resultFiles in prev
    const prevWithout = { aiAvailable: true, repositoryId: 42, workspaceId: 10 };

    mockDb.orderBy.mockResolvedValueOnce([]);
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    mockReadFile
      .mockResolvedValueOnce('{"decisions":[]}')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('[]');
    mockStoreReports.mockResolvedValueOnce(undefined);

    const { runTriageStep } = await import('./triage-report.ts');
    // Should not throw
    const result = await runTriageStep({ ctx: makeCtx(), prev: prevWithout });
    expect(result.reportsGenerated).toBe(true);
  });
});
