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
const mockCreateTest = vi.fn();
const mockUpsertFinding = vi.fn();
const mockUpdateTestFindingsCount = vi.fn();
const mockAddScanFile = vi.fn();
const mockEnsureWorkspace = vi.fn();
const mockEnsureTeam = vi.fn();
const mockEnsureRepository = vi.fn();
const mockCreateWorkspaceEvent = vi.fn();

vi.mock('../entities.ts', () => ({
  createTest: (...args: unknown[]) => mockCreateTest(...args),
  upsertFinding: (...args: unknown[]) => mockUpsertFinding(...args),
  updateTestFindingsCount: (...args: unknown[]) => mockUpdateTestFindingsCount(...args),
  addScanFile: (...args: unknown[]) => mockAddScanFile(...args),
  ensureWorkspace: (...args: unknown[]) => mockEnsureWorkspace(...args),
  ensureTeam: (...args: unknown[]) => mockEnsureTeam(...args),
  ensureRepository: (...args: unknown[]) => mockEnsureRepository(...args),
  createWorkspaceEvent: (...args: unknown[]) => mockCreateWorkspaceEvent(...args),
}));

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
    cloneUrl: 'https://github.com/org/repo.git',
    reportLanguage: 'en',
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

  it('exports importToDatabase as a function', async () => {
    const mod = await import('./import-results.ts');
    expect(typeof mod.importToDatabase).toBe('function');
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
    ];
    expect(Object.keys(TOOL_MAP)).toEqual(expect.arrayContaining(expectedKeys));
    expect(Object.keys(TOOL_MAP)).toHaveLength(14);
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

// ── importToDatabase ─────────────────────────────────────────────

describe('importToDatabase', () => {
  it('skips stats files (scanType === "_stats")', async () => {
    const resultFiles = [
      { key: 'git-stats', filename: 'git-contributor-stats.json', scanType: '_stats', testTitle: '', content_b64: 'W10=' },
    ];

    const { importToDatabase } = await import('./import-results.ts');
    const summary = await importToDatabase('scan-1', 10, resultFiles);

    expect(summary.imports).toHaveLength(0);
    expect(mockCreateTest).not.toHaveBeenCalled();
  });

  it('creates test, parses results, and upserts findings for gitleaks', async () => {
    const content = JSON.stringify([{ RuleID: 'secret' }]);
    const content_b64 = Buffer.from(content).toString('base64');
    const resultFiles = [
      { key: 'gitleaks', filename: 'gitleaks-results.json', scanType: 'Gitleaks Scan', testTitle: '', content_b64 },
    ];

    mockCreateTest.mockResolvedValueOnce({ id: 100 });
    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseGitleaks.mockReturnValueOnce([
      { title: 'Secret found', severity: 'High', description: 'desc', filePath: 'a.ts', line: 1, vulnIdFromTool: 'secret', cwe: null, cvssScore: null },
    ]);
    mockUpsertFinding.mockResolvedValueOnce({ id: 1 });
    mockUpdateTestFindingsCount.mockResolvedValueOnce(undefined);

    const { importToDatabase } = await import('./import-results.ts');
    const summary = await importToDatabase('scan-1', 10, resultFiles);

    expect(summary.imports).toHaveLength(1);
    expect(summary.imports[0]).toEqual({ key: 'gitleaks', testId: 100, findingsCount: 1 });
    expect(mockCreateTest).toHaveBeenCalledWith(expect.objectContaining({ tool: 'gitleaks', scanType: 'Gitleaks Scan' }));
    expect(mockParseGitleaks).toHaveBeenCalledWith(content);
    expect(mockUpsertFinding).toHaveBeenCalledTimes(1);
    expect(mockUpdateTestFindingsCount).toHaveBeenCalledWith(100, 1);
  });

  it('uses parseSarif for code-analysis files', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'code-analysis', filename: 'code-analysis.sarif', scanType: 'SARIF', testTitle: 'BEAST Code Analysis', content_b64 },
    ];

    mockCreateTest.mockResolvedValueOnce({ id: 101 });
    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseSarif.mockReturnValueOnce([]);
    mockUpdateTestFindingsCount.mockResolvedValueOnce(undefined);

    const { importToDatabase } = await import('./import-results.ts');
    await importToDatabase('scan-1', 10, resultFiles);

    expect(mockParseSarif).toHaveBeenCalledWith('{}');
    expect(mockCreateTest).toHaveBeenCalledWith(expect.objectContaining({ tool: 'beast' }));
  });

  it('uses parseSarif for jf-audit files', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'jf-audit', filename: 'jf-audit-results.sarif', scanType: 'SARIF', testTitle: 'JFrog Xray', content_b64 },
    ];

    mockCreateTest.mockResolvedValueOnce({ id: 102 });
    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseSarif.mockReturnValueOnce([]);
    mockUpdateTestFindingsCount.mockResolvedValueOnce(undefined);

    const { importToDatabase } = await import('./import-results.ts');
    await importToDatabase('scan-1', 10, resultFiles);

    expect(mockParseSarif).toHaveBeenCalled();
    expect(mockCreateTest).toHaveBeenCalledWith(expect.objectContaining({ tool: 'jfrog' }));
  });

  it('uses parseTrufflehog for trufflehog files', async () => {
    const content_b64 = Buffer.from('[]').toString('base64');
    const resultFiles = [
      { key: 'trufflehog', filename: 'trufflehog-results.json', scanType: 'Trufflehog Scan', testTitle: '', content_b64 },
    ];

    mockCreateTest.mockResolvedValueOnce({ id: 103 });
    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseTrufflehog.mockReturnValueOnce([]);
    mockUpdateTestFindingsCount.mockResolvedValueOnce(undefined);

    const { importToDatabase } = await import('./import-results.ts');
    await importToDatabase('scan-1', 10, resultFiles);

    expect(mockParseTrufflehog).toHaveBeenCalled();
  });

  it('uses parseTrivy for trivy-sca files', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'trivy-sca', filename: 'trivy-sca-results.json', scanType: 'Trivy SCA', testTitle: '', content_b64 },
    ];

    mockCreateTest.mockResolvedValueOnce({ id: 104 });
    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockParseTrivy.mockReturnValueOnce([]);
    mockUpdateTestFindingsCount.mockResolvedValueOnce(undefined);

    const { importToDatabase } = await import('./import-results.ts');
    await importToDatabase('scan-1', 10, resultFiles);

    expect(mockParseTrivy).toHaveBeenCalled();
  });

  it('captures errors per result file without failing entire import', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'gitleaks', filename: 'gitleaks-results.json', scanType: 'Gitleaks Scan', testTitle: '', content_b64 },
    ];

    mockCreateTest.mockRejectedValueOnce(new Error('DB connection failed'));

    const { importToDatabase } = await import('./import-results.ts');
    const summary = await importToDatabase('scan-1', 10, resultFiles);

    expect(summary.imports).toHaveLength(1);
    expect(summary.imports[0].error).toBe('DB connection failed');
    expect(summary.imports[0].testId).toBeUndefined();
  });

  it('returns empty parsed array for unknown file keys', async () => {
    const content_b64 = Buffer.from('{}').toString('base64');
    const resultFiles = [
      { key: 'unknown-tool', filename: 'unknown.json', scanType: 'Custom', testTitle: '', content_b64 },
    ];

    mockCreateTest.mockResolvedValueOnce({ id: 105 });
    mockAddScanFile.mockResolvedValueOnce(undefined);
    mockUpdateTestFindingsCount.mockResolvedValueOnce(undefined);

    const { importToDatabase } = await import('./import-results.ts');
    const summary = await importToDatabase('scan-1', 10, resultFiles);

    expect(summary.imports[0].findingsCount).toBe(0);
    expect(mockUpsertFinding).not.toHaveBeenCalled();
  });
});

// ── setupDatabase ────────────────────────────────────────────────

describe('setupDatabase', () => {
  it('looks up repo by name when workspaceId > 0', async () => {
    mockDbResolves([{ id: 42, teamId: 5 }]);

    const { setupDatabase } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10 });
    const ids = await setupDatabase(ctx);

    expect(ids.workspaceId).toBe(10);
    expect(ids.repositoryId).toBe(42);
    expect(ids.teamId).toBe(5);
    expect(mockEnsureWorkspace).not.toHaveBeenCalled();
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
  it('stores both profile and report', async () => {
    mockAddScanFile.mockResolvedValue(undefined);

    const { storeReports } = await import('./import-results.ts');
    await storeReports('scan-1', 'report content', 'profile content');

    expect(mockAddScanFile).toHaveBeenCalledTimes(2);
    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      fileName: 'repo-profile.md',
      fileType: 'profile',
      content: 'profile content',
    }));
    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      fileName: 'final-report.md',
      fileType: 'audit',
      content: 'report content',
    }));
  });

  it('skips profile when empty', async () => {
    mockAddScanFile.mockResolvedValue(undefined);

    const { storeReports } = await import('./import-results.ts');
    await storeReports('scan-1', 'report content', '');

    expect(mockAddScanFile).toHaveBeenCalledTimes(1);
    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'final-report.md',
    }));
  });

  it('skips report when empty', async () => {
    mockAddScanFile.mockResolvedValue(undefined);

    const { storeReports } = await import('./import-results.ts');
    await storeReports('scan-1', '', 'profile content');

    expect(mockAddScanFile).toHaveBeenCalledTimes(1);
    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'repo-profile.md',
    }));
  });

  it('stores nothing when both empty', async () => {
    const { storeReports } = await import('./import-results.ts');
    await storeReports('scan-1', '', '');

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

  it('queues feedback compilation for contributors with new assessments', async () => {
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
    await ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1);

    expect(mockQueueFeedbackCompilation).toHaveBeenCalledWith(100);
    expect(mockQueueFeedbackCompilation).toHaveBeenCalledWith(200);
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

    // Should not throw
    await expect(ingestContributorStats(ctx, 'scan-1', 10, resultFiles as any, [], 1))
      .resolves.toBeUndefined();
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

// ── runImportStep ────────────────────────────────────────────────

describe('runImportStep', () => {
  it('orchestrates all sub-functions', async () => {
    // Setup DB lookup
    mockDbResolves([{ id: 42, teamId: 5 }]);
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
    expect(typeof result.findingsImported).toBe('number');
    expect(typeof result.testsCreated).toBe('number');
    expect(Array.isArray(result.resultFiles)).toBe(true);
  });

  it('logs tool warnings', async () => {
    mockDbResolves([{ id: 42, teamId: 5 }]);
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

  it('calculates totalFindings from import summary', async () => {
    // Setup DB
    mockDbResolves([{ id: 42, teamId: 5 }]);
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

    mockCreateTest.mockResolvedValueOnce({ id: 100 });
    mockAddScanFile.mockResolvedValue(undefined);
    mockParseGitleaks.mockReturnValueOnce([
      { title: 'Secret', severity: 'High', description: 'd', filePath: 'a.ts', line: 1 },
      { title: 'Secret2', severity: 'Medium', description: 'd', filePath: 'b.ts', line: 2 },
    ]);
    mockUpsertFinding.mockResolvedValue({ id: 1 });
    mockUpdateTestFindingsCount.mockResolvedValue(undefined);

    const { runImportStep } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10 });
    const result = await runImportStep({ ctx, prev: {} });

    expect(result.findingsImported).toBe(2);
  });

  it('does not add git-stats to resultFiles when extractGitStats returns empty', async () => {
    mockDbResolves([{ id: 42, teamId: 5 }]);
    mockExecSync.mockReturnValueOnce('');
    mockReadFileSync.mockImplementation(() => { throw new Error('not found'); });

    const { runImportStep } = await import('./import-results.ts');
    const ctx = makeCtx({ workspaceId: 10 });
    const result = await runImportStep({ ctx, prev: {} });

    const gitStatsFile = result.resultFiles.find((f: any) => f.key === 'git-stats');
    expect(gitStatsFile).toBeUndefined();
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
