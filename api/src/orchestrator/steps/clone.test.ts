import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';

// ── Mock child_process ─────────────────────────────────────────────
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// ── Mock fs ────────────────────────────────────────────────────────
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockRmSync = vi.fn();
const mockChownSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  chownSync: (...args: unknown[]) => mockChownSync(...args),
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
    chownSync: (...args: unknown[]) => mockChownSync(...args),
  },
}));

// ── Mock entities ─────────────────────────────────────────────────
const mockGetRepoCloneCredentials = vi.fn();
vi.mock('../entities.ts', () => ({
  getRepoCloneCredentials: (...args: unknown[]) => mockGetRepoCloneCredentials(...args),
}));

// ── Mock git-providers ────────────────────────────────────────────
const mockBuildAuthCloneUrl = vi.fn();
vi.mock('../git-providers.ts', () => ({
  buildAuthCloneUrl: (...args: unknown[]) => mockBuildAuthCloneUrl(...args),
}));

import { cloneRepo, runCloneStep } from './clone.ts';

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    scanId: 'scan-1',
    repoUrl: 'https://github.com/org/repo.git',
    repoName: 'repo',
    branch: '',
    commitHash: '',
    localPath: '',
    teamName: 'team-a',
    workspaceName: 'org',
    workspaceId: 10,
    workDir: '/workspace/repo',
    repoPath: '/workspace/repo/repo',
    toolsDir: '/workspace/repo/results',
    agentDir: '/workspace/repo',
    resultsDir: '/workspace/repo/results',
    profilePath: '/workspace/repo/repo-profile.md',
    cloneUrl: 'https://github.com/org/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    ...overrides,
  } as PipelineContext;
}

describe('cloneRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: repo doesn't exist yet
    mockExistsSync.mockReturnValue(false);
  });

  it('exports a callable function', () => {
    expect(typeof cloneRepo).toBe('function');
  });

  it('performs fresh clone when repo does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await cloneRepo(makeCtx());

    expect(mockMkdirSync).toHaveBeenCalledWith('/workspace/repo', { recursive: true });
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git clone'),
      expect.objectContaining({ timeout: 300_000 }),
    );
  });

  it('fetches and pulls when repo already exists', async () => {
    // .git dir exists
    mockExistsSync.mockImplementation((p: string) => p.endsWith('/.git'));

    await cloneRepo(makeCtx());

    const commands = mockExecSync.mock.calls.map((c: any) => c[0]);
    expect(commands[0]).toContain('git fetch --all --prune');
    expect(commands[1]).toContain('git pull');
    // clone no longer manages toolsDir/agentDir — pipeline handles that
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('uses local path mode when cloneUrl is empty', async () => {
    mockExistsSync.mockReturnValue(true); // local path exists

    await cloneRepo(makeCtx({ cloneUrl: '', localPath: '/some/local/path' }));

    expect(mockExecSync).not.toHaveBeenCalled();
    // clone no longer creates directories — just validates the path
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('throws when local path does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(
      cloneRepo(makeCtx({ cloneUrl: '', localPath: '/bad/path' })),
    ).rejects.toThrow('does not exist');
  });

  it('throws when clone command fails', async () => {
    mockExistsSync.mockReturnValue(false);
    // mkdir succeeds, then git clone fails
    mockExecSync.mockImplementationOnce(() => {
      const err: any = new Error('git clone failed');
      err.status = 128;
      err.stderr = Buffer.from('fatal: repo not found');
      err.stdout = Buffer.from('');
      throw err;
    });

    await expect(cloneRepo(makeCtx())).rejects.toThrow('Clone failed');
  });

  it('checks out specific branch when provided', async () => {
    mockExistsSync.mockReturnValue(false);

    await cloneRepo(makeCtx({ branch: 'develop' }));

    const commands = mockExecSync.mock.calls.map((c: any) => c[0]);
    expect(commands).toContainEqual(expect.stringContaining('git checkout develop'));
  });

  it('checks out specific commit when provided', async () => {
    mockExistsSync.mockReturnValue(false);

    await cloneRepo(makeCtx({ commitHash: 'abc123' }));

    const commands = mockExecSync.mock.calls.map((c: any) => c[0]);
    expect(commands).toContainEqual(expect.stringContaining('git checkout abc123'));
  });

  it('on existing repo with branch, checks out and pulls', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('/.git'));

    await cloneRepo(makeCtx({ branch: 'feature' }));

    const commands = mockExecSync.mock.calls.map((c: any) => c[0]);
    expect(commands).toContainEqual('git fetch --all --prune');
    expect(commands).toContainEqual('git checkout feature');
    expect(commands).toContainEqual('git pull origin feature');
  });

  it('on existing repo with commitHash, checks out commit', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('/.git'));

    await cloneRepo(makeCtx({ commitHash: 'deadbeef' }));

    const commands = mockExecSync.mock.calls.map((c: any) => c[0]);
    expect(commands).toContainEqual('git fetch --all --prune');
    expect(commands).toContainEqual('git checkout deadbeef');
  });
});

// ── runCloneStep ───────────────────────────────────────────────────

describe('runCloneStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockGetRepoCloneCredentials.mockResolvedValue(null);
    mockBuildAuthCloneUrl.mockImplementation((_p: string, url: string) => url);
  });

  it('exports a callable function', () => {
    expect(typeof runCloneStep).toBe('function');
  });

  it('returns CloneOutput shape', async () => {
    mockExistsSync.mockReturnValue(false);

    const ctx = makeCtx({ branch: 'main', commitHash: 'abc123' });
    const result = await runCloneStep({ ctx, prev: {} });

    expect(result).toEqual({
      repoPath: ctx.repoPath,
      cloneUrl: ctx.cloneUrl,
      branch: ctx.branch,
      commitHash: ctx.commitHash,
    });
  });

  it('creates toolsDir and agentDir after clone', async () => {
    mockExistsSync.mockReturnValue(false);

    const ctx = makeCtx();
    await runCloneStep({ ctx, prev: {} });

    expect(mockMkdirSync).toHaveBeenCalledWith(ctx.toolsDir, { recursive: true });
    expect(mockMkdirSync).toHaveBeenCalledWith(ctx.agentDir, { recursive: true });
  });

  it('resolves authenticated clone URL when credentials exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const creds = { provider: 'github', token: 'ghp_secret', email: undefined };
    mockGetRepoCloneCredentials.mockResolvedValue(creds);
    mockBuildAuthCloneUrl.mockReturnValue('https://x-access-token:ghp_secret@github.com/org/repo.git');

    const ctx = makeCtx();
    const originalCloneUrl = ctx.cloneUrl;
    const result = await runCloneStep({ ctx, prev: {} });

    expect(mockGetRepoCloneCredentials).toHaveBeenCalledWith(ctx.repoName, ctx.repoUrl);
    expect(mockBuildAuthCloneUrl).toHaveBeenCalledWith(
      creds.provider,
      originalCloneUrl,
      creds.token,
      creds.email,
    );
    expect(result.cloneUrl).toBe('https://x-access-token:ghp_secret@github.com/org/repo.git');
  });

  it('skips credential resolution when cloneUrl is empty', async () => {
    mockExistsSync.mockReturnValue(true);

    const ctx = makeCtx({ cloneUrl: '', localPath: '/some/local/path' });
    await runCloneStep({ ctx, prev: {} });

    expect(mockGetRepoCloneCredentials).not.toHaveBeenCalled();
    expect(mockBuildAuthCloneUrl).not.toHaveBeenCalled();
  });

  it('does not modify ctx.cloneUrl when credentials are null', async () => {
    mockExistsSync.mockReturnValue(false);
    mockGetRepoCloneCredentials.mockResolvedValue(null);

    const ctx = makeCtx();
    const originalUrl = ctx.cloneUrl;
    const result = await runCloneStep({ ctx, prev: {} });

    expect(mockBuildAuthCloneUrl).not.toHaveBeenCalled();
    expect(result.cloneUrl).toBe(originalUrl);
  });

  it('cleans and recreates toolsDir when it already exists', async () => {
    // repo exists (so fetch path), toolsDir also exists
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('/.git')) return true;
      if (p === '/workspace/repo/results') return true;
      return false;
    });

    const ctx = makeCtx();
    await runCloneStep({ ctx, prev: {} });

    expect(mockRmSync).toHaveBeenCalledWith(ctx.toolsDir, { recursive: true, force: true });
    expect(mockMkdirSync).toHaveBeenCalledWith(ctx.toolsDir, { recursive: true });
  });

  it('cleans and recreates agentDir when it already exists', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('/.git')) return true;
      if (p === '/workspace/repo') return true;
      return false;
    });

    const ctx = makeCtx();
    await runCloneStep({ ctx, prev: {} });

    expect(mockRmSync).toHaveBeenCalledWith(ctx.agentDir, { recursive: true, force: true });
    expect(mockMkdirSync).toHaveBeenCalledWith(ctx.agentDir, { recursive: true });
  });
});
