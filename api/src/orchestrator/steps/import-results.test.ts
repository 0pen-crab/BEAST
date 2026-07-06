import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs ──────────────────────────────────────────────────────
const mockStatSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('fs', () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// ── Mock child_process ───────────────────────────────────────────
const mockExecSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// ── Mock entities ────────────────────────────────────────────────
// createTest/upsertFinding/updateTestFindingsCount stay spied so the tests can
// PROVE the prepare step never writes repo data (they moved to the commit step).
const mockCreateTest = vi.fn();
const mockUpsertFinding = vi.fn();
const mockUpdateTestFindingsCount = vi.fn();
const mockAddScanFile = vi.fn();
const mockEnsureWorkspace = vi.fn();
const mockEnsureTeam = vi.fn();
const mockEnsureRepository = vi.fn();
const mockCreateWorkspaceEvent = vi.fn();

vi.mock('../entities.ts', async (importOriginal) => {
  // computeFingerprint / normalizeSeverity are pure helpers — use the real ones
  // so prepared fingerprints match what the commit step will compute.
  const actual = await importOriginal<typeof import('../entities.ts')>();
  return {
    computeFingerprint: actual.computeFingerprint,
    normalizeSeverity: actual.normalizeSeverity,
    createTest: (...args: unknown[]) => mockCreateTest(...args),
    upsertFinding: (...args: unknown[]) => mockUpsertFinding(...args),
    updateTestFindingsCount: (...args: unknown[]) => mockUpdateTestFindingsCount(...args),
    addScanFile: (...args: unknown[]) => mockAddScanFile(...args),
    ensureWorkspace: (...args: unknown[]) => mockEnsureWorkspace(...args),
    ensureTeam: (...args: unknown[]) => mockEnsureTeam(...args),
    ensureRepository: (...args: unknown[]) => mockEnsureRepository(...args),
    createWorkspaceEvent: (...args: unknown[]) => mockCreateWorkspaceEvent(...args),
  };
});

// ── Mock parsers ─────────────────────────────────────────────────
const mockParseSarif = vi.fn().mockReturnValue([]);
const mockParseGitleaks = vi.fn().mockReturnValue([]);
const mockParseTrufflehog = vi.fn().mockReturnValue([]);
const mockParseTrivy = vi.fn().mockReturnValue([]);

vi.mock('./parsers.ts', () => ({
  parseSarif: (...args: unknown[]) => mockParseSarif(...args),
  parseGitleaks: (...args: unknown[]) => mockParseGitleaks(...args),
  parseTrufflehog: (...args: unknown[]) => mockParseTrufflehog(...args),
  parseTrivy: (...args: unknown[]) => mockParseTrivy(...args),
}));

// ── Mock contributors ────────────────────────────────────────────
const mockIngestContributors = vi.fn();
const mockFindOrCreateContributor = vi.fn();

vi.mock('../../routes/contributors.ts', () => ({
  ingestContributors: (...args: unknown[]) => mockIngestContributors(...args),
  findOrCreateContributor: (...args: unknown[]) => mockFindOrCreateContributor(...args),
}));

// ── Mock feedback worker ─────────────────────────────────────────
const mockQueueFeedbackCompilation = vi.fn();

vi.mock('../feedback-worker.ts', () => ({
  queueFeedbackCompilation: (...args: unknown[]) => mockQueueFeedbackCompilation(...args),
}));

// ── Mock DB (drizzle) ────────────────────────────────────────────
import { db } from '../../db/index.ts';
const mockDb = db as any;

function mockDbResolves(value: unknown) {
  mockDb.then = (resolve: (v: unknown) => void) => resolve(value);
}

// Resolve successive `await db…` calls with successive values (last value sticks).
function mockDbResolvesSeq(values: unknown[]) {
  let i = 0;
  mockDb.then = (resolve: (v: unknown) => void) => resolve(values[Math.min(i++, values.length - 1)]);
}

// ── Helper: make pipeline context ────────────────────────────────
function makeCtx(overrides: Record<string, unknown> = {}): any {
  return {
    scanId: 'scan-1',
    repoUrl: 'https://github.com/org/repo.git',
    repoName: 'repo',
    branch: 'main',
    commitHash: 'abc123',
    localPath: '',
    teamName: 'default',
    workspaceName: 'ws',
    workspaceId: 0,
    workDir: '/tmp/work',
    repoPath: '/tmp/work/repo',
    toolsDir: '/tmp/work/results',
    agentDir: '/tmp/work/agent',
    resultsDir: '/tmp/work/results',
    profilePath: '/tmp/work/agent/repo-profile.md',
    scanContextPath: '/tmp/work/agent/scan-context.md',
    cloneUrl: 'https://github.com/org/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    aiModelAnalyzer: 'sonnet',
    aiModelScanner: 'opus',
    aiModelTriage: 'opus',
    ...overrides,
  };
}

// ── beforeEach ───────────────────────────────────────────────────
beforeEach(() => {
  mockStatSync.mockReset();
  mockReadFileSync.mockReset();
  mockExistsSync.mockReset();
  mockExecSync.mockReset();
  mockCreateTest.mockReset();
  mockUpsertFinding.mockReset();
  mockUpdateTestFindingsCount.mockReset();
  mockAddScanFile.mockReset();
  mockEnsureWorkspace.mockReset();
  mockEnsureTeam.mockReset();
  mockEnsureRepository.mockReset();
  mockCreateWorkspaceEvent.mockReset();
  mockParseSarif.mockReset().mockReturnValue([]);
  mockParseGitleaks.mockReset().mockReturnValue([]);
  mockParseTrufflehog.mockReset().mockReturnValue([]);
  mockParseTrivy.mockReset().mockReturnValue([]);
  mockIngestContributors.mockReset();
  mockFindOrCreateContributor.mockReset();
  mockQueueFeedbackCompilation.mockReset();

  // By default, statSync throws ENOENT (file does not exist)
  mockStatSync.mockImplementation(() => {
    const err: any = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  });

  // Reset mock DB chainable methods
  delete mockDb.then;
  mockDb.select = vi.fn().mockReturnValue(mockDb);
  mockDb.from = vi.fn().mockReturnValue(mockDb);
  mockDb.where = vi.fn().mockReturnValue(mockDb);
  mockDb.update = vi.fn().mockReturnValue(mockDb);
  mockDb.set = vi.fn().mockReturnValue(mockDb);
  mockDb.insert = vi.fn().mockReturnValue(mockDb);
  mockDb.values = vi.fn().mockReturnValue(mockDb);
});

// ── Module exports ───────────────────────────────────────────────

describe('import-results module exports', () => {
  it('exports readResults as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.readResults).toBe('function');
  });

  it('exports prepareImportPlan as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.prepareImportPlan).toBe('function');
  });

  it('exports matchExistingFindings as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.matchExistingFindings).toBe('function');
  });

  it('exports setupDatabase as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.setupDatabase).toBe('function');
  });

  it('exports storeReports as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.storeReports).toBe('function');
  });

  it('exports ingestContributorStats as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.ingestContributorStats).toBe('function');
  });

  it('exports extractGitStats as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.extractGitStats).toBe('function');
  });

  it('exports runImportStep as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.runImportStep).toBe('function');
  });
});

// ── TOOL_MAP ─────────────────────────────────────────────────────

describe('TOOL_MAP', () => {
  it('contains all expected tool keys', async () => {
    const { TOOL_MAP } = await import('./import-results.ts');
    const expectedKeys = [
      'code-analysis', 'gitleaks', 'trufflehog',
      'trivy-secrets', 'trivy-sca', 'trivy-iac',
      'jf-audit', 'semgrep', 'osv-scanner',
      'checkov', 'gitguardian', 'snyk-sca', 'snyk-code', 'snyk-iac',
      'presidio', 'semgrep-pii',
    ];
    expect(Object.keys(TOOL_MAP)).toEqual(expect.arrayContaining(expectedKeys));
    expect(Object.keys(TOOL_MAP)).toHaveLength(16);
  });
});

// ── TOOL_CATEGORY_MAP ───────────────────────────────────────────

describe('TOOL_CATEGORY_MAP', () => {
  it('maps all tools to a category', async () => {
    const { TOOL_CATEGORY_MAP, TOOL_MAP } = await import('./import-results.ts');
    // Every tool in TOOL_MAP should have a category
    for (const tool of Object.values(TOOL_MAP)) {
      expect(TOOL_CATEGORY_MAP).toHaveProperty(tool);
    }
  });

  it('maps PII tools to pii category', async () => {
    const { TOOL_CATEGORY_MAP } = await import('./import-results.ts');
    expect(TOOL_CATEGORY_MAP['presidio']).toBe('pii');
    expect(TOOL_CATEGORY_MAP['semgrep-pii']).toBe('pii');
  });

  it('maps secrets tools to secrets category', async () => {
    const { TOOL_CATEGORY_MAP } = await import('./import-results.ts');
    expect(TOOL_CATEGORY_MAP['gitleaks']).toBe('secrets');
    expect(TOOL_CATEGORY_MAP['trufflehog']).toBe('secrets');
    expect(TOOL_CATEGORY_MAP['trivy-secrets']).toBe('secrets');
    expect(TOOL_CATEGORY_MAP['gitguardian']).toBe('secrets');
  });

  it('maps trivy variants to different categories', async () => {
    const { TOOL_CATEGORY_MAP } = await import('./import-results.ts');
    expect(TOOL_CATEGORY_MAP['trivy-secrets']).toBe('secrets');
    expect(TOOL_CATEGORY_MAP['trivy-sca']).toBe('sca');
    expect(TOOL_CATEGORY_MAP['trivy-iac']).toBe('iac');
  });

  it('maps semgrep variants to different categories', async () => {
    const { TOOL_CATEGORY_MAP } = await import('./import-results.ts');
    expect(TOOL_CATEGORY_MAP['semgrep']).toBe('sast');
    expect(TOOL_CATEGORY_MAP['semgrep-pii']).toBe('pii');
  });
});

// ── readResults ──────────────────────────────────────────────────

describe('readResults', () => {
  it('reads existing result files from disk', async () => {
    const fileContent = Buffer.from(JSON.stringify([{ rule: 'test' }]));

    mockStatSync.mockImplementation((filePath: string) => {
      if (filePath.includes('gitleaks-results.json')) return { size: fileContent.length };
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('gitleaks-results.json')) return fileContent;
      throw new Error('not found');
    });

    const { readResults } = await import('./import-results.ts');
    const result = await readResults({ resultsDir: '/tmp/results' });

    expect(result.length).toBe(1);
    expect(result[0].key).toBe('gitleaks');
    expect(result[0].filename).toBe('gitleaks-results.json');
    expect(result[0].content_b64).toBe(fileContent.toString('base64'));
  });

  it('skips files that do not exist', async () => {
    // Default mockStatSync throws ENOENT for all files
    const { readResults } = await import('./import-results.ts');
    const result = await readResults({ resultsDir: '/tmp/results' });

    expect(result).toHaveLength(0);
  });

  it('skips empty files', async () => {
    mockStatSync.mockImplementation((filePath: string) => {
      if (filePath.includes('gitleaks-results.json')) return { size: 0 };
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const { readResults } = await import('./import-results.ts');
    const result = await readResults({ resultsDir: '/tmp/results' });

    expect(result).toHaveLength(0);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('reads multiple result files', async () => {
    const content1 = Buffer.from('{"gitleaks": true}');
    const content2 = Buffer.from('{"trivy": true}');

    mockStatSync.mockImplementation((filePath: string) => {
      if (filePath.includes('gitleaks-results.json')) return { size: content1.length };
      if (filePath.includes('trivy-sca-results.json')) return { size: content2.length };
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('gitleaks-results.json')) return content1;
      if (filePath.includes('trivy-sca-results.json')) return content2;
      throw new Error('not found');
    });

    const { readResults } = await import('./import-results.ts');
    const result = await readResults({ resultsDir: '/tmp/results' });

    expect(result.length).toBe(2);
    expect(result.map(r => r.key)).toContain('gitleaks');
    expect(result.map(r => r.key)).toContain('trivy-sca');
  });
});

// ── prepareImportPlan ────────────────────────────────────────────
// The prepare step must NOT write repo data: no createTest, no upsertFinding,
// no updateTestFindingsCount. It builds a serializable plan the commit step
// writes after the whole pipeline has succeeded (maintainer policy).

describe('prepareImportPlan', () => {
  it('skips stats files (scanType === "_stats")', async () => {
    const resultFiles = [
      { key: 'git-stats', filename: 'git-contributor-stats.json', scanType: '_stats', testTitle: '', content_b64: 'W10=' },
    ];

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    expect(summary.imports).toHaveLength(0);
    expect(summary.preparedTests).toHaveLength(0);
    expect(summary.preparedFindings).toHaveLength(0);
  });

  it('prepares a test + findings for gitleaks WITHOUT writing them to the DB', async () => {
    const content = JSON.stringify([{ RuleID: 'secret' }]);
    const content_b64 = Buffer.from(content).toString('base64');
    const resultFiles = [
      { key: 'gitleaks', filename: 'gitleaks-results.json', scanType: 'Gitleaks Scan', testTitle: '', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseGitleaks.mockReturnValueOnce([
      { title: 'Secret found', severity: 'High', description: 'desc', filePath: 'a.ts', line: 1, vulnIdFromTool: 'secret', cwe: null, cvssScore: null, secretValue: 'sk-123' },
    ]);
    mockDbResolves([]); // matchExistingFindings → no existing rows

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    expect(summary.imports).toHaveLength(1);
    expect(summary.imports[0]).toEqual({ key: 'gitleaks', findingsCount: 1 });
    expect(mockParseGitleaks).toHaveBeenCalledWith(content, 'gitleaks-results.json');

    expect(summary.preparedTests).toEqual([expect.objectContaining({
      key: 'gitleaks',
      tool: 'gitleaks',
      scanType: 'Gitleaks Scan',
      fileName: 'gitleaks-results.json',
      findingsCount: 1,
    })]);
    expect(summary.preparedFindings).toEqual([expect.objectContaining({
      tempId: 0,
      testKey: 'gitleaks',
      title: 'Secret found',
      severity: 'High',
      tool: 'gitleaks',
      category: 'secrets',
      secretValue: 'sk-123',
    })]);
    expect(summary.preparedFindings[0].fingerprint).toMatch(/^[0-9a-f]{40}$/);
    expect(summary.preparedFindings[0].matchedFindingId).toBeUndefined();

    // NO repo-data writes in the prepare step — they belong to commit
    expect(mockCreateTest).not.toHaveBeenCalled();
    expect(mockUpsertFinding).not.toHaveBeenCalled();
    expect(mockUpdateTestFindingsCount).not.toHaveBeenCalled();
    // Raw artifact IS stored (scan_files = diagnostic data, allowed mid-scan)
    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      fileName: 'gitleaks-results.json',
      fileType: 'raw-gitleaks',
    }));
  });

  it('collapses duplicate reports by fingerprint — prepared count is distinct, raw count preserved', async () => {
    // A tool can report the same finding multiple times (e.g. one CVE on a package
    // that appears in several lockfile entries). The plan collapses them so the
    // committed rows and the per-tool count match the (deduplicated) findings list.
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'osv-scanner', filename: 'osv-scanner-results.sarif', scanType: 'SARIF', testTitle: '', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseSarif.mockReturnValueOnce([
      { title: 'CVE-1 in lodash', severity: 'High', description: 'd', filePath: 'package-lock.json', line: 1, vulnIdFromTool: 'CVE-1', cwe: null, cvssScore: null },
      { title: 'CVE-1 in lodash', severity: 'High', description: 'd', filePath: 'package-lock.json', line: 1, vulnIdFromTool: 'CVE-1', cwe: null, cvssScore: null },
      { title: 'CVE-2 in axios', severity: 'Medium', description: 'd', filePath: 'package-lock.json', line: 5, vulnIdFromTool: 'CVE-2', cwe: null, cvssScore: null },
    ]);
    mockDbResolves([]);

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    // 3 parsed, 2 distinct fingerprints → 2 prepared findings, count 2
    expect(summary.preparedFindings).toHaveLength(2);
    expect(summary.preparedTests[0].findingsCount).toBe(2);
    expect(summary.imports[0].findingsCount).toBe(3); // raw parsed count for the log
  });

  it('records matchedFindingId for findings that match existing DB rows (read-only dedup)', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'semgrep', filename: 'semgrep-results.sarif', scanType: 'SARIF', testTitle: 'Semgrep SAST', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseSarif.mockReturnValueOnce([
      { title: 'XSS', severity: 'High', description: 'd', filePath: 'a.ts', line: 3, vulnIdFromTool: 'xss-rule', cwe: null, cvssScore: null },
      { title: 'SQLi', severity: 'Critical', description: 'd', filePath: 'b.ts', line: 9, vulnIdFromTool: 'sqli-rule', cwe: null, cvssScore: null },
    ]);

    // Compute the real fingerprint the plan will produce for the first finding
    const { computeFingerprint } = await vi.importActual<typeof import('../entities.ts')>('../entities.ts');
    const fp = computeFingerprint('semgrep', 'a.ts', 3, 'xss-rule', 'XSS');
    mockDbResolves([{ id: 777, fingerprint: fp }]);

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    expect(summary.preparedFindings[0].matchedFindingId).toBe(777);
    expect(summary.preparedFindings[1].matchedFindingId).toBeUndefined();
    // Matching is READ-ONLY — the update/re-parent happens at commit
    expect(mockUpsertFinding).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('normalizes severity and forces PII findings to Info', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'presidio', filename: 'presidio-results.sarif', scanType: 'SARIF', testTitle: 'Presidio PII', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseSarif.mockReturnValueOnce([
      { title: 'Email address', severity: 'HIGH', description: 'd', filePath: 'a.ts', line: 1, vulnIdFromTool: 'pii', cwe: null, cvssScore: null },
    ]);
    mockDbResolves([]);

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    expect(summary.preparedFindings[0].severity).toBe('Info');
    expect(summary.preparedFindings[0].category).toBe('pii');
  });

  it('uses parseSarif for code-analysis files and maps the beast tool', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'code-analysis', filename: 'code-analysis.sarif', scanType: 'SARIF', testTitle: 'BEAST Code Analysis', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseSarif.mockReturnValueOnce([]);

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    expect(mockParseSarif).toHaveBeenCalledWith('{}', 'code-analysis.sarif');
    expect(summary.preparedTests[0].tool).toBe('beast');
  });

  it('uses parseSarif for jf-audit files and maps the jfrog tool', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'jf-audit', filename: 'jf-audit-results.sarif', scanType: 'SARIF', testTitle: 'JFrog Xray', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseSarif.mockReturnValueOnce([]);

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    expect(mockParseSarif).toHaveBeenCalled();
    expect(summary.preparedTests[0].tool).toBe('jfrog');
  });

  it('uses parseTrufflehog for trufflehog files', async () => {
    const content_b64 = Buffer.from('[]').toString('base64');
    const resultFiles = [
      { key: 'trufflehog', filename: 'trufflehog-results.json', scanType: 'Trufflehog Scan', testTitle: '', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseTrufflehog.mockReturnValueOnce([]);

    const { prepareImportPlan } = await import('./import-results.ts');
    await prepareImportPlan('scan-1', 10, resultFiles);

    expect(mockParseTrufflehog).toHaveBeenCalled();
  });

  it('uses parseTrivy for trivy-sca files', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'trivy-sca', filename: 'trivy-sca-results.json', scanType: 'Trivy SCA', testTitle: '', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseTrivy.mockReturnValueOnce([]);

    const { prepareImportPlan } = await import('./import-results.ts');
    await prepareImportPlan('scan-1', 10, resultFiles);

    expect(mockParseTrivy).toHaveBeenCalled();
  });

  it('captures errors per result file without failing the entire prepare', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'gitleaks', filename: 'gitleaks-results.json', scanType: 'Gitleaks Scan', testTitle: '', content_b64 },
    ];

    mockAddScanFile.mockRejectedValueOnce(new Error('DB connection failed'));

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    expect(summary.imports).toHaveLength(1);
    expect(summary.imports[0].error).toBe('DB connection failed');
    expect(summary.preparedTests).toHaveLength(0);
  });

  it('returns empty parsed array for unknown file keys', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'unknown-tool', filename: 'unknown.json', scanType: 'Custom', testTitle: '', content_b64 },
    ];

    mockAddScanFile.mockResolvedValueOnce(undefined);

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles);

    expect(summary.imports[0].findingsCount).toBe(0);
    expect(summary.preparedFindings).toHaveLength(0);
  });
});

// ── matchExistingFindings ────────────────────────────────────────

describe('matchExistingFindings', () => {
  it('returns an empty map without querying when there are no fingerprints', async () => {
    const { matchExistingFindings } = await import('./import-results.ts');
    const result = await matchExistingFindings(10, []);

    expect(result.size).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns an empty map without querying when repositoryId is falsy (legacy scans)', async () => {
    const { matchExistingFindings } = await import('./import-results.ts');
    const result = await matchExistingFindings(0, ['fp-1']);

    expect(result.size).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('maps fingerprints to existing finding ids, first row winning on duplicates', async () => {
    mockDbResolves([
      { id: 5, fingerprint: 'fp-a' },
      { id: 9, fingerprint: 'fp-a' }, // duplicate fingerprint — first wins (mirrors upsertFinding)
      { id: 7, fingerprint: 'fp-b' },
    ]);

    const { matchExistingFindings } = await import('./import-results.ts');
    const result = await matchExistingFindings(10, ['fp-a', 'fp-b', 'fp-c']);

    expect(result.get('fp-a')).toBe(5);
    expect(result.get('fp-b')).toBe(7);
    expect(result.has('fp-c')).toBe(false);
  });
});

// ── setupDatabase ────────────────────────────────────────────────

describe('setupDatabase', () => {
  it('uses the scan\'s own repository_id when workspaceId > 0 (not a name lookup)', async () => {
    // Two repos can share a name across sources (e.g. a bitbucket + a local-upload
    // "trinity"). Resolving by name picked the wrong one and misattributed findings.
    // The scan row is the source of truth — its repository_id must win.
    // 1st await → scan row {repositoryId: 157}; 2nd await → repo row {id: 157, teamId: 5}
    mockDbResolvesSeq([[{ repositoryId: 157 }], [{ id: 157, teamId: 5 }]]);

    const { setupDatabase } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10, repoName: 'trinity' });
    const ids = await setupDatabase(ctx);

    expect(ids.workspaceId).toBe(10);
    expect(ids.repositoryId).toBe(157);
    expect(ids.teamId).toBe(5);
    expect(mockEnsureWorkspace).not.toHaveBeenCalled();
  });

  it('falls back to legacy path when the scan has no repository_id', async () => {
    // scan row has no repositoryId → drop to ensureWorkspace/Team/Repository
    mockDbResolvesSeq([[{ repositoryId: null }]]);
    mockEnsureWorkspace.mockResolvedValueOnce({ id: 1 });
    mockEnsureTeam.mockResolvedValueOnce({ id: 2 });
    mockEnsureRepository.mockResolvedValueOnce({ id: 3 });

    const { setupDatabase } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10 });
    const ids = await setupDatabase(ctx);

    expect(ids.repositoryId).toBe(3);
    expect(mockEnsureWorkspace).toHaveBeenCalled();
  });

  it('falls back to legacy path when workspaceId is 0', async () => {
    mockEnsureWorkspace.mockResolvedValueOnce({ id: 1 });
    mockEnsureTeam.mockResolvedValueOnce({ id: 2 });
    mockEnsureRepository.mockResolvedValueOnce({ id: 3 });

    const { setupDatabase } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 0 });
    const ids = await setupDatabase(ctx);

    expect(mockEnsureWorkspace).toHaveBeenCalledWith('ws');
    expect(mockEnsureTeam).toHaveBeenCalledWith(1, 'default');
    expect(mockEnsureRepository).toHaveBeenCalledWith(2, 'repo', 'https://github.com/org/repo.git');
    expect(ids.workspaceId).toBe(1);
    expect(ids.teamId).toBe(2);
    expect(ids.repositoryId).toBe(3);
  });

  it('calls ensure functions on legacy path', async () => {
    mockEnsureWorkspace.mockResolvedValueOnce({ id: 1 });
    mockEnsureTeam.mockResolvedValueOnce({ id: 2 });
    mockEnsureRepository.mockResolvedValueOnce({ id: 3 });

    const { setupDatabase } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 0 });
    await setupDatabase(ctx);

    expect(mockEnsureWorkspace).toHaveBeenCalledTimes(1);
    expect(mockEnsureTeam).toHaveBeenCalledTimes(1);
    expect(mockEnsureRepository).toHaveBeenCalledTimes(1);
  });

  it('links scan to repo on legacy path', async () => {
    mockEnsureWorkspace.mockResolvedValueOnce({ id: 1 });
    mockEnsureTeam.mockResolvedValueOnce({ id: 2 });
    mockEnsureRepository.mockResolvedValueOnce({ id: 3 });

    const { setupDatabase } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 0 });
    await setupDatabase(ctx);

    // db.update(scans).set({ repositoryId, workspaceId }).where(...)
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: 3, workspaceId: 1 }));
  });

  it('passes undefined repoUrl when empty', async () => {
    mockEnsureWorkspace.mockResolvedValueOnce({ id: 1 });
    mockEnsureTeam.mockResolvedValueOnce({ id: 2 });
    mockEnsureRepository.mockResolvedValueOnce({ id: 3 });

    const { setupDatabase } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 0, repoUrl: '' });
    await setupDatabase(ctx);

    expect(mockEnsureRepository).toHaveBeenCalledWith(2, 'repo', undefined);
  });

  it('always uses "default" as team name', async () => {
    mockEnsureWorkspace.mockResolvedValueOnce({ id: 1 });
    mockEnsureTeam.mockResolvedValueOnce({ id: 2 });
    mockEnsureRepository.mockResolvedValueOnce({ id: 3 });

    const { setupDatabase } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 0, teamName: 'custom-team' });
    await setupDatabase(ctx);

    expect(mockEnsureTeam).toHaveBeenCalledWith(1, 'default');
  });
});

// ── storeReports ─────────────────────────────────────────────────

describe('storeReports', () => {
  it('stores the audit report only (profile is persisted by the analyzer step)', async () => {
    mockAddScanFile.mockResolvedValue(undefined);

    const { storeReports } = await import('./import-results.ts');
    await storeReports('scan-1', 'report content');

    expect(mockAddScanFile).toHaveBeenCalledTimes(1);
    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      fileName: 'final-report.md',
      fileType: 'audit',
      content: 'report content',
    }));
    // Must NOT store a 'profile' file — that would duplicate the analyzer's.
    expect(mockAddScanFile).not.toHaveBeenCalledWith(expect.objectContaining({
      fileType: 'profile',
    }));
  });

  it('stores nothing when report is empty', async () => {
    const { storeReports } = await import('./import-results.ts');
    await storeReports('scan-1', '');

    expect(mockAddScanFile).not.toHaveBeenCalled();
  });
});

// ── ingestContributorStats ───────────────────────────────────────

describe('ingestContributorStats', () => {
  it('returns early when no git-stats file', async () => {
    const { ingestContributorStats } = await import('./import-results.ts');
    const ctx = makeCtx();
    await ingestContributorStats(ctx, 'scan-1', 10, [], [], 1);

    expect(mockIngestContributors).not.toHaveBeenCalled();
  });

  it('returns early when invalid JSON', async () => {
    const { ingestContributorStats } = await import('./import-results.ts');
    const ctx = makeCtx();
    const resultFiles = [{
      key: 'git-stats',
      content_b64: Buffer.from('not json').toString('base64'),
    }];
    await ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1);

    expect(mockIngestContributors).not.toHaveBeenCalled();
  });

  it('records scan + workspace events when git-stats JSON is corrupt (must not be silent)', async () => {
    mockCreateWorkspaceEvent.mockResolvedValueOnce(undefined);

    const { ingestContributorStats } = await import('./import-results.ts');
    const ctx = makeCtx();
    const resultFiles = [{
      key: 'git-stats',
      content_b64: Buffer.from('{"corrupt').toString('base64'),
    }];
    await ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1);

    expect(mockIngestContributors).not.toHaveBeenCalled();
    // scan_events insert
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      level: 'error',
      source: 'contributor-ingest',
      message: expect.stringContaining('git-stats'),
    }));
    // workspace event for the Events feed
    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(1, 'contributor_ingest_failed', expect.objectContaining({
      scan_id: 'scan-1',
      repo_name: 'repo',
      error: expect.stringContaining('git-stats'),
    }));
  });

  it('returns early when empty array', async () => {
    const { ingestContributorStats } = await import('./import-results.ts');
    const ctx = makeCtx();
    const resultFiles = [{
      key: 'git-stats',
      content_b64: Buffer.from('[]').toString('base64'),
    }];
    await ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1);

    expect(mockIngestContributors).not.toHaveBeenCalled();
  });

  it('calls ingestContributors when valid', async () => {
    mockIngestContributors.mockResolvedValueOnce({ newAssessments: 0, contributorIds: {} });

    const { ingestContributorStats } = await import('./import-results.ts');
    const ctx = makeCtx();
    const stats = [{ email: 'dev@example.com', name: 'Dev', commits: 5 }];
    const resultFiles = [{
      key: 'git-stats',
      content_b64: Buffer.from(JSON.stringify(stats)).toString('base64'),
    }];
    await ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1);

    expect(mockIngestContributors).toHaveBeenCalledWith(expect.objectContaining({
      repoName: 'repo',
      workspaceId: 1,
      executionId: 'scan-1',
      contributors: stats,
    }));
  });

  // Feedback compilation must NOT be queued here — the pipeline queues the
  // returned ids only after the whole scan succeeds (a failed scan must not
  // update developer profiles).
  it('returns contributor ids with new assessments WITHOUT queueing feedback', async () => {
    mockIngestContributors.mockResolvedValueOnce({
      newAssessments: 2,
      contributorIds: { 'dev@a.com': 100, 'dev@b.com': 200 },
    });

    const { ingestContributorStats } = await import('./import-results.ts');
    const ctx = makeCtx();
    const stats = [{ email: 'dev@a.com', name: 'A' }, { email: 'dev@b.com', name: 'B' }];
    const resultFiles = [{
      key: 'git-stats',
      content_b64: Buffer.from(JSON.stringify(stats)).toString('base64'),
    }];
    const ids = await ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1);

    expect(ids.sort()).toEqual([100, 200]);
    expect(mockQueueFeedbackCompilation).not.toHaveBeenCalled();
  });

  it('returns no ids when there are no new assessments', async () => {
    mockIngestContributors.mockResolvedValueOnce({
      newAssessments: 0,
      contributorIds: { 'dev@a.com': 100 },
    });

    const { ingestContributorStats } = await import('./import-results.ts');
    const ctx = makeCtx();
    const stats = [{ email: 'dev@a.com', name: 'A' }];
    const resultFiles = [{
      key: 'git-stats',
      content_b64: Buffer.from(JSON.stringify(stats)).toString('base64'),
    }];
    const ids = await ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1);

    expect(ids).toEqual([]);
  });

  it('handles failure gracefully', async () => {
    mockIngestContributors.mockRejectedValueOnce(new Error('ingest failed'));
    mockDb.insert = vi.fn().mockReturnValue(mockDb);
    mockDb.values = vi.fn().mockResolvedValue(undefined);
    mockCreateWorkspaceEvent.mockResolvedValueOnce(undefined);

    const { ingestContributorStats } = await import('./import-results.ts');
    const ctx = makeCtx();
    const stats = [{ email: 'dev@example.com', name: 'Dev' }];
    const resultFiles = [{
      key: 'git-stats',
      content_b64: Buffer.from(JSON.stringify(stats)).toString('base64'),
    }];

    // Should not throw — returns no ids on ingest failure
    await expect(ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1))
      .resolves.toEqual([]);
  });
});

// ── extractGitStats ──────────────────────────────────────────────

describe('extractGitStats', () => {
  it('parses git log output into contributor stats', async () => {
    const logOutput = [
      'dev@example.com|Dev User|2026-01-15T10:30:00+00:00',
      '10\t5\tsrc/main.ts',
      '3\t1\tsrc/util.js',
      '',
      'dev@example.com|Dev User|2026-01-16T11:00:00+00:00',
      '7\t2\tsrc/main.ts',
      '',
    ].join('\n');

    mockExecSync.mockReturnValueOnce(logOutput);

    const { extractGitStats } = await import('./import-results.ts');
    const stats = extractGitStats('/tmp/repo');

    expect(stats).toHaveLength(1);
    expect(stats[0].email).toBe('dev@example.com');
    expect(stats[0].name).toBe('Dev User');
    expect(stats[0].commits).toBe(2);
    expect(stats[0].loc_added).toBe(20);
    expect(stats[0].loc_removed).toBe(8);
    expect(stats[0].first_commit).toBe('2026-01-15');
    expect(stats[0].last_commit).toBe('2026-01-16');
    expect(stats[0].file_types['.ts']).toBe(2);
    expect(stats[0].file_types['.js']).toBe(1);
    expect(stats[0].daily_activity['2026-01-15']).toBe(1);
    expect(stats[0].daily_activity['2026-01-16']).toBe(1);
  });

  it('returns empty on failure', async () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error('git not found'); });

    const { extractGitStats } = await import('./import-results.ts');
    const stats = extractGitStats('/tmp/repo');

    expect(stats).toEqual([]);
  });

  it('returns empty on empty output', async () => {
    mockExecSync.mockReturnValueOnce('');

    const { extractGitStats } = await import('./import-results.ts');
    const stats = extractGitStats('/tmp/repo');

    expect(stats).toEqual([]);
  });

  it('handles binary files (dash for added/removed)', async () => {
    const logOutput = [
      'dev@example.com|Dev User|2026-01-15T10:30:00+00:00',
      '-\t-\timage.png',
      '5\t2\tsrc/app.ts',
      '',
    ].join('\n');

    mockExecSync.mockReturnValueOnce(logOutput);

    const { extractGitStats } = await import('./import-results.ts');
    const stats = extractGitStats('/tmp/repo');

    expect(stats).toHaveLength(1);
    // Binary file dashes should not add to loc counts
    expect(stats[0].loc_added).toBe(5);
    expect(stats[0].loc_removed).toBe(2);
  });

  it('lowercases emails', async () => {
    const logOutput = [
      'DEV@EXAMPLE.COM|Dev User|2026-01-15T10:30:00+00:00',
      '1\t0\tfile.ts',
      '',
    ].join('\n');

    mockExecSync.mockReturnValueOnce(logOutput);

    const { extractGitStats } = await import('./import-results.ts');
    const stats = extractGitStats('/tmp/repo');

    expect(stats[0].email).toBe('dev@example.com');
  });

  it('tracks file extensions', async () => {
    const logOutput = [
      'dev@example.com|Dev|2026-01-15T10:30:00+00:00',
      '10\t2\tsrc/app.ts',
      '5\t1\tsrc/style.css',
      '3\t0\tsrc/index.html',
      '1\t0\tsrc/app.ts',
      '',
    ].join('\n');

    mockExecSync.mockReturnValueOnce(logOutput);

    const { extractGitStats } = await import('./import-results.ts');
    const stats = extractGitStats('/tmp/repo');

    expect(stats[0].file_types['.ts']).toBe(2);
    expect(stats[0].file_types['.css']).toBe(1);
    expect(stats[0].file_types['.html']).toBe(1);
  });
});

// ── mergeStatsByContributor ──────────────────────────────────────

describe('mergeStatsByContributor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stat(overrides: Record<string, unknown> = {}) {
    return {
      email: 'dev@a.com',
      name: 'Dev',
      commits: 1,
      loc_added: 10,
      loc_removed: 2,
      first_commit: '2026-01-01',
      last_commit: '2026-01-10',
      file_types: { '.ts': 1 },
      daily_activity: { '2026-01-10': 1 },
      ...overrides,
    };
  }

  it('an alias with a NEWER last_commit wins the display name', async () => {
    // Both emails resolve to the same contributor
    mockFindOrCreateContributor.mockResolvedValue(7);

    const { mergeStatsByContributor } = await import('./import-results.ts');
    const { merged } = await mergeStatsByContributor([
      stat({ email: 'old@a.com', name: 'Old Name', last_commit: '2025-06-01', first_commit: '2025-01-01' }),
      stat({ email: 'new@a.com', name: 'New Name', last_commit: '2026-03-01', first_commit: '2026-01-01' }),
    ] as any, 1);

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('New Name');
    expect(merged[0].last_commit).toBe('2026-03-01');
    expect(merged[0].first_commit).toBe('2025-01-01');
    expect(merged[0].commits).toBe(2);
  });

  it('an alias with an OLDER last_commit does not steal the display name', async () => {
    mockFindOrCreateContributor.mockResolvedValue(7);

    const { mergeStatsByContributor } = await import('./import-results.ts');
    const { merged } = await mergeStatsByContributor([
      stat({ email: 'new@a.com', name: 'New Name', last_commit: '2026-03-01' }),
      stat({ email: 'old@a.com', name: 'Old Name', last_commit: '2025-06-01' }),
    ] as any, 1);

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('New Name');
    expect(merged[0].last_commit).toBe('2026-03-01');
  });

  it('builds email alias map for multi-email contributors', async () => {
    mockFindOrCreateContributor.mockResolvedValue(7);

    const { mergeStatsByContributor } = await import('./import-results.ts');
    const { emailAliases } = await mergeStatsByContributor([
      stat({ email: 'a@a.com' }),
      stat({ email: 'b@a.com' }),
    ] as any, 1);

    expect(emailAliases['a@a.com']).toEqual(['b@a.com']);
  });
});

// ── runImportStep ────────────────────────────────────────────────

describe('runImportStep', () => {
  it('orchestrates all sub-functions and emits the prepared plan', async () => {
    // Setup DB lookup
    mockDbResolvesSeq([[{ repositoryId: 42 }], [{ id: 42, teamId: 5 }]]);
    // extractGitStats returns empty
    mockExecSync.mockReturnValueOnce('');
    // readResults: no files on disk
    // profilePath read fails (no profile)
    mockReadFileSync.mockImplementation(() => { throw new Error('not found'); });

    const { runImportStep } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10 });
    const result = await runImportStep({ ctx, prev: {} });

    expect(result.repositoryId).toBe(42);
    expect(result.workspaceId).toBe(10);
    expect(typeof result.findingsPrepared).toBe('number');
    expect(typeof result.testsPrepared).toBe('number');
    expect(Array.isArray(result.resultFiles)).toBe(true);
    expect(Array.isArray(result.preparedTests)).toBe(true);
    expect(Array.isArray(result.preparedFindings)).toBe(true);
    expect(Array.isArray(result.analyzerAssessments)).toBe(true);
  });

  it('does NOT ingest contributor stats or write repo data (moved to the commit step)', async () => {
    mockDbResolvesSeq([[{ repositoryId: 42 }], [{ id: 42, teamId: 5 }]]);
    // extractGitStats returns real stats — they must ride along, not be ingested
    mockExecSync.mockReturnValueOnce([
      'dev@example.com|Dev User|2026-01-15T10:30:00+00:00',
      '10\t5\tsrc/main.ts',
      '',
    ].join('\n'));
    mockReadFileSync.mockImplementation(() => { throw new Error('not found'); });
    mockFindOrCreateContributor.mockResolvedValue(1);

    const { runImportStep } = await import('./import-results.ts');
    const result = await runImportStep({ ctx: makeCtx({ workspaceId: 10 }), prev: {} });

    expect(mockIngestContributors).not.toHaveBeenCalled();
    expect(mockCreateTest).not.toHaveBeenCalled();
    expect(mockUpsertFinding).not.toHaveBeenCalled();
    // git-stats ride along in resultFiles for the commit step to ingest
    const gitStatsFile = result.resultFiles.find((f: any) => f.key === 'git-stats');
    expect(gitStatsFile).toBeDefined();
  });

  it('logs tool warnings', async () => {
    mockDbResolvesSeq([[{ repositoryId: 42 }], [{ id: 42, teamId: 5 }]]);
    mockExecSync.mockReturnValueOnce('');
    mockReadFileSync.mockImplementation(() => { throw new Error('not found'); });

    // scanEvents insert mock
    const insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockDb.insert = insertMock;

    const { runImportStep } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10 });
    const prev = {
      toolWarnings: [
        { tool: 'semgrep', level: 'warning' as const, message: 'Semgrep not installed', details: {} },
      ],
    };
    await runImportStep({ ctx, prev });

    // Should have called db.insert for the scan event warning
    expect(insertMock).toHaveBeenCalled();
  });

  it('counts prepared (deduplicated) findings in findingsPrepared', async () => {
    // Setup DB
    mockDbResolvesSeq([[{ repositoryId: 42 }], [{ id: 42, teamId: 5 }]]);
    mockExecSync.mockReturnValueOnce('');
    mockReadFileSync.mockImplementation(() => { throw new Error('not found'); });

    // Make a gitleaks file appear in readResults
    const content = Buffer.from(JSON.stringify([{ RuleID: 'key' }]));
    mockStatSync.mockImplementation((filePath: string) => {
      if (filePath.includes('gitleaks-results.json')) return { size: content.length };
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('gitleaks-results.json')) return content;
      throw new Error('not found');
    });

    mockAddScanFile.mockResolvedValue(undefined);
    mockParseGitleaks.mockReturnValueOnce([
      { title: 'Secret', severity: 'High', description: 'd', filePath: 'a.ts', line: 1 },
      { title: 'Secret2', severity: 'Medium', description: 'd', filePath: 'b.ts', line: 2 },
    ]);

    const { runImportStep } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10 });
    const result = await runImportStep({ ctx, prev: {} });

    expect(result.findingsPrepared).toBe(2);
    expect(result.preparedFindings).toHaveLength(2);
    expect(result.testsPrepared).toBe(1);
  });

  it('does not add git-stats to resultFiles when extractGitStats returns empty', async () => {
    mockDbResolvesSeq([[{ repositoryId: 42 }], [{ id: 42, teamId: 5 }]]);
    mockExecSync.mockReturnValueOnce('');
    mockReadFileSync.mockImplementation(() => { throw new Error('not found'); });

    const { runImportStep } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10 });
    const result = await runImportStep({ ctx, prev: {} });

    const gitStatsFile = result.resultFiles.find((f: any) => f.key === 'git-stats');
    expect(gitStatsFile).toBeUndefined();
  });
});

// ── error screaming (corrupt tool output / assessments) ─────────

describe('corrupt tool output handling', () => {
  it('prepareImportPlan records the parser error for the corrupt tool and continues with the others', async () => {
    const resultFiles = [
      { key: 'gitleaks', filename: 'gitleaks-results.json', scanType: 'Gitleaks Scan', testTitle: '', content_b64: Buffer.from('{"trunc').toString('base64') },
      { key: 'trufflehog', filename: 'trufflehog-results.json', scanType: 'Trufflehog Scan', testTitle: '', content_b64: Buffer.from('[]').toString('base64') },
    ];
    mockAddScanFile.mockResolvedValue(undefined);
    mockParseGitleaks.mockImplementationOnce(() => {
      throw new Error('[parseGitleaks] Failed to parse gitleaks-results.json — file may be corrupt or truncated');
    });
    mockParseTrufflehog.mockReturnValueOnce([]);

    const { prepareImportPlan } = await import('./import-results.ts');
    const summary = await prepareImportPlan('scan-1', 10, resultFiles as any);

    expect(summary.imports).toHaveLength(2);
    expect(summary.imports[0].key).toBe('gitleaks');
    expect(summary.imports[0].error).toContain('parseGitleaks');
    // The other tool is still prepared
    expect(summary.imports[1]).toEqual(expect.objectContaining({ key: 'trufflehog', findingsCount: 0 }));
    expect(summary.preparedTests.map(t => t.key)).toEqual(['trufflehog']);
  });

  it('prepareImportPlan passes the file name to the parser for descriptive errors', async () => {
    const content = '[]';
    const resultFiles = [
      { key: 'gitleaks', filename: 'gitleaks-results.json', scanType: 'Gitleaks Scan', testTitle: '', content_b64: Buffer.from(content).toString('base64') },
    ];
    mockAddScanFile.mockResolvedValue(undefined);

    const { prepareImportPlan } = await import('./import-results.ts');
    await prepareImportPlan('scan-1', 10, resultFiles as any);

    expect(mockParseGitleaks).toHaveBeenCalledWith(content, 'gitleaks-results.json');
  });

  it('runImportStep logs an error scan event when one tool import fails', async () => {
    mockDbResolvesSeq([[{ repositoryId: 42 }], [{ id: 42, teamId: 5 }]]);
    mockExecSync.mockReturnValueOnce('');

    const content = Buffer.from('{"trunc');
    mockStatSync.mockImplementation((filePath: string) => {
      if (String(filePath).includes('gitleaks-results.json')) return { size: content.length };
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (String(filePath).includes('gitleaks-results.json')) return content;
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    mockAddScanFile.mockResolvedValue(undefined);
    mockParseGitleaks.mockImplementationOnce(() => { throw new Error('[parseGitleaks] corrupt'); });

    const { runImportStep } = await import('./import-results.ts');
    await runImportStep({ ctx: makeCtx({ workspaceId: 10 }), prev: {} });

    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('Import failed for gitleaks'),
    }));
  });
});

describe('contributor-assessments.json handling', () => {
  it('stays quiet when the file is absent (ENOENT is normal)', async () => {
    mockDbResolvesSeq([[{ repositoryId: 42 }], [{ id: 42, teamId: 5 }]]);
    mockExecSync.mockReturnValueOnce('');
    mockReadFileSync.mockImplementation(() => {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const { runImportStep } = await import('./import-results.ts');
    await runImportStep({ ctx: makeCtx({ workspaceId: 10 }), prev: {} });

    const eventMessages = mockDb.values.mock.calls.map((c: any[]) => String(c[0]?.message ?? ''));
    expect(eventMessages.join('\n')).not.toContain('contributor-assessments');
  });

  it('records an error scan event when the file is corrupt JSON', async () => {
    mockDbResolvesSeq([[{ repositoryId: 42 }], [{ id: 42, teamId: 5 }]]);
    mockExecSync.mockReturnValueOnce('');
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (String(filePath).includes('contributor-assessments.json')) return 'corrupt{{{';
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const { runImportStep } = await import('./import-results.ts');
    await runImportStep({ ctx: makeCtx({ workspaceId: 10 }), prev: {} });

    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('contributor-assessments.json'),
    }));
  });
});

// ── deduplicateAssessments ───────────────────────────────────────

describe('deduplicateAssessments', () => {
  it('keeps single assessment per contributor', async () => {
    mockFindOrCreateContributor.mockResolvedValueOnce(1);
    mockFindOrCreateContributor.mockResolvedValueOnce(1); // same contributor

    const { deduplicateAssessments } = await import('./import-results.ts');
    const assessments = [
      { email: 'dev@a.com', feedback: 'short' },
      { email: 'dev@b.com', feedback: 'longer feedback text' },
    ];
    const result = await deduplicateAssessments(assessments, 1);

    expect(result).toHaveLength(1);
  });

  it('keeps all when different contributor IDs', async () => {
    mockFindOrCreateContributor.mockResolvedValueOnce(1);
    mockFindOrCreateContributor.mockResolvedValueOnce(2);

    const { deduplicateAssessments } = await import('./import-results.ts');
    const assessments = [
      { email: 'dev@a.com', feedback: 'feedback a' },
      { email: 'dev@b.com', feedback: 'feedback b' },
    ];
    const result = await deduplicateAssessments(assessments, 1);

    expect(result).toHaveLength(2);
  });

  it('skips entries without email', async () => {
    mockFindOrCreateContributor.mockResolvedValueOnce(1);

    const { deduplicateAssessments } = await import('./import-results.ts');
    const assessments = [
      { email: 'dev@a.com', feedback: 'feedback' },
      { feedback: 'no email' },
    ];
    const result = await deduplicateAssessments(assessments, 1);

    expect(result).toHaveLength(1);
    expect(mockFindOrCreateContributor).toHaveBeenCalledTimes(1);
  });

  it('prefers assessment with longer feedback', async () => {
    mockFindOrCreateContributor.mockResolvedValueOnce(1);
    mockFindOrCreateContributor.mockResolvedValueOnce(1);

    const { deduplicateAssessments } = await import('./import-results.ts');
    const assessments = [
      { email: 'dev@a.com', feedback: 'short' },
      { email: 'dev@b.com', feedback: 'this is the longer feedback text that should win' },
    ];
    const result = await deduplicateAssessments(assessments, 1) as Array<{ feedback: string }>;

    expect(result).toHaveLength(1);
    expect(result[0].feedback).toBe('this is the longer feedback text that should win');
  });
});

// ── deduplicateFeedbackText ──────────────────────────────────────

describe('extractCodeSnippet', () => {
  it('extracts 15 lines (7 above + target + 7 below)', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(lines.join('\n'));

    const { extractCodeSnippet } = await import('./import-results.ts');
    const result = extractCodeSnippet('/repo', 'file.ts', 15);

    expect(result).toBeDefined();
    // Should contain line 8 (7 above target 15) through line 22 (7 below target 15)
    const resultLines = result!.split('\n');
    expect(resultLines).toHaveLength(15);
    // Target line (15) should be marked with >
    const markerLine = resultLines.find(l => l.startsWith('>'));
    expect(markerLine).toContain('line 15');
  });

  it('handles target near start of file', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(lines.join('\n'));

    const { extractCodeSnippet } = await import('./import-results.ts');
    const result = extractCodeSnippet('/repo', 'file.ts', 3);

    expect(result).toBeDefined();
    // Can't go 7 above line 3, so starts from line 1
    const resultLines = result!.split('\n');
    // Should include lines 1-10 (line 3 target, 2 above, 7 below)
    expect(resultLines.length).toBeGreaterThanOrEqual(10);
    expect(resultLines[0]).toContain('line 1');
  });

  it('handles target near end of file', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(lines.join('\n'));

    const { extractCodeSnippet } = await import('./import-results.ts');
    const result = extractCodeSnippet('/repo', 'file.ts', 19);

    expect(result).toBeDefined();
    const resultLines = result!.split('\n');
    // Should include up to line 20 (end of file)
    expect(resultLines[resultLines.length - 1]).toContain('line 20');
  });

  it('returns undefined for missing file', async () => {
    mockExistsSync.mockReturnValue(false);

    const { extractCodeSnippet } = await import('./import-results.ts');
    const result = extractCodeSnippet('/repo', 'missing.ts', 5);

    expect(result).toBeUndefined();
  });

  it('returns undefined when line is null', async () => {
    const { extractCodeSnippet } = await import('./import-results.ts');
    const result = extractCodeSnippet('/repo', 'file.ts', null);

    expect(result).toBeUndefined();
  });
});

describe('deduplicateFeedbackText', () => {
  it('removes duplicated sections', async () => {
    const { deduplicateFeedbackText } = await import('./import-results.ts');
    // Build text with a duplicated "**Strengths:**" section (> 200 chars)
    const section = '**Strengths:**\n' + 'A'.repeat(200);
    const feedback = section + '\n\n' + section;
    const result = deduplicateFeedbackText(feedback);

    expect(result).not.toBe(feedback);
    // Should contain only one occurrence of **Strengths:**
    const count = (result.match(/\*\*Strengths:\*\*/g) || []).length;
    expect(count).toBe(1);
  });

  it('returns short text unchanged', async () => {
    const { deduplicateFeedbackText } = await import('./import-results.ts');
    const short = 'This is short feedback.';
    expect(deduplicateFeedbackText(short)).toBe(short);
  });

  it('returns text without duplicates unchanged', async () => {
    const { deduplicateFeedbackText } = await import('./import-results.ts');
    const text = '**Strengths:**\n' + 'A'.repeat(200) + '\n**Weaknesses:**\nSome text here.';
    expect(deduplicateFeedbackText(text)).toBe(text);
  });
});
