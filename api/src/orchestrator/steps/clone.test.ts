import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';

// ── Mock child_process ─────────────────────────────────────────────
// clone.ts uses async execFile('git', [args], opts, cb) — never execSync.
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

type ExecFileCb = (err: (Error & { code?: number | string; name?: string }) | null, stdout: string, stderr: string) => void;

/** Default mock: every git command succeeds. */
function execFileOk(_file: string, _args: string[], _opts: unknown, cb: ExecFileCb): void {
  cb(null, '', '');
}

/** Builds a mock implementation that fails once with the given exit code + stderr. */
function execFileFail(code: number, stderr: string) {
  return (_file: string, _args: string[], _opts: unknown, cb: ExecFileCb): void => {
    const err: Error & { code?: number } = new Error(`Command failed: git`);
    err.code = code;
    cb(err as Error & { code: number }, '', stderr);
  };
}

/** All git invocations reconstructed as "git <args...>" strings, in call order. */
function gitCommands(): string[] {
  return mockExecFile.mock.calls.map((c) => ['git', ...(c[1] as string[])].join(' '));
}

function cloneCalls(): string[] {
  return gitCommands().filter((c) => c.startsWith('git clone'));
}

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

import { cloneRepo, runCloneStep, stripCredentials } from './clone.ts';

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    scanId: 'scan-1',
    repositoryId: 42,
    repoUrl: 'https://github.com/org/repo.git',
    repoName: 'repo',
    branch: '',
    commitHash: '',
    localPath: '',
    teamName: 'team-a',
    workspaceName: 'org',
    workspaceId: 10,
    repoBaseDir: '/workspace/src-1/repo',
    workDir: '/workspace/repo',
    repoPath: '/workspace/repo/repo',
    toolsDir: '/workspace/repo/results',
    agentDir: '/workspace/repo',
    resultsDir: '/workspace/repo/results',
    profilePath: '/workspace/repo/repo-profile.md',
    scanContextPath: '/workspace/repo/scan-context.md',
    cloneUrl: 'https://github.com/org/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    aiModelAnalyzer: 'sonnet',
    aiModelScanner: 'opus',
    aiModelTriage: 'opus',
    ...overrides,
  } as PipelineContext;
}

const DNS_STDERR = "fatal: unable to access 'https://example.com/foo': Could not resolve host: example.com (DNS server returned general failure)";

describe('cloneRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: repo doesn't exist yet; git commands succeed
    mockExistsSync.mockReturnValue(false);
    mockExecFile.mockImplementation(execFileOk);
  });

  it('exports a callable function', () => {
    expect(typeof cloneRepo).toBe('function');
  });

  it('performs fresh clone when repo does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await cloneRepo(makeCtx());

    expect(mockMkdirSync).toHaveBeenCalledWith('/workspace/repo', { recursive: true });
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://github.com/org/repo.git', '/workspace/repo/repo'],
      // 20 min per git command — corporate proxy throttles egress (~700 KiB/s)
      expect.objectContaining({ timeout: 1_200_000 }),
      expect.any(Function),
    );
  });

  it('fetches and pulls when repo already exists', async () => {
    // .git dir exists
    mockExistsSync.mockImplementation((p: string) => p.endsWith('/.git'));

    await cloneRepo(makeCtx());

    const commands = gitCommands();
    expect(commands).toContainEqual('git fetch --all --prune');
    expect(commands.some((c) => c.includes('git pull'))).toBe(true);
    // clone no longer manages toolsDir/agentDir — pipeline handles that
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('uses local path mode when cloneUrl is empty', async () => {
    mockExistsSync.mockReturnValue(true); // local path exists

    await cloneRepo(makeCtx({ cloneUrl: '', localPath: '/some/local/path' }));

    expect(mockExecFile).not.toHaveBeenCalled();
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
    mockExecFile.mockImplementationOnce(execFileFail(128, 'fatal: repo not found'));

    await expect(cloneRepo(makeCtx())).rejects.toThrow('Clone failed');
  });

  it('preserves the "Clone failed (exit N): ..." error message format', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFile.mockImplementationOnce(execFileFail(128, 'fatal: repo not found'));

    await expect(cloneRepo(makeCtx())).rejects.toThrow('Clone failed (exit 128): fatal: repo not found');
  });

  it('falls back to stdout in the error message when stderr is empty', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFile.mockImplementationOnce((_f: string, _a: string[], _o: unknown, cb: ExecFileCb) => {
      const err: Error & { code?: number } = new Error('Command failed');
      err.code = 1;
      cb(err as Error & { code: number }, 'stdout detail', '');
    });

    await expect(cloneRepo(makeCtx())).rejects.toThrow('Clone failed (exit 1): stdout detail');
  });

  describe('transient DNS retry (async backoff, no busy-wait)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries clone on transient DNS errors and succeeds on a later attempt', async () => {
      mockExistsSync.mockReturnValue(false);
      // First two attempts: DNS fail. Third: success (default impl).
      mockExecFile
        .mockImplementationOnce(execFileFail(128, DNS_STDERR))
        .mockImplementationOnce(execFileFail(128, DNS_STDERR));

      const done = cloneRepo(makeCtx());
      await vi.runAllTimersAsync();
      await done;

      expect(cloneCalls()).toHaveLength(3);
    });

    it('waits with async backoff between retries instead of busy-waiting', async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecFile
        .mockImplementationOnce(execFileFail(128, DNS_STDERR))
        .mockImplementationOnce(execFileFail(128, DNS_STDERR));

      const done = cloneRepo(makeCtx());
      done.catch(() => { /* inspected below */ });

      // First attempt fires immediately, then sleeps — no second attempt yet
      await vi.advanceTimersByTimeAsync(0);
      expect(cloneCalls()).toHaveLength(1);

      // Backoff #1: 2s
      await vi.advanceTimersByTimeAsync(2000);
      expect(cloneCalls()).toHaveLength(2);

      // Backoff #2: 4s (exponential)
      await vi.advanceTimersByTimeAsync(4000);
      expect(cloneCalls()).toHaveLength(3);

      await done;
    });

    it('gives up after 3 attempts and rethrows the DNS error', async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecFile.mockImplementation(execFileFail(128, DNS_STDERR));

      const done = cloneRepo(makeCtx());
      const assertion = expect(done).rejects.toThrow('Clone failed (exit 128)');
      await vi.runAllTimersAsync();
      await assertion;

      expect(cloneCalls()).toHaveLength(3);
    });

    it('does NOT retry on non-DNS clone errors (auth, 404, etc.)', async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecFile.mockImplementationOnce(
        execFileFail(128, "fatal: Authentication failed for 'https://example.com/foo'"),
      );

      const done = cloneRepo(makeCtx());
      const assertion = expect(done).rejects.toThrow('Clone failed');
      await vi.runAllTimersAsync();
      await assertion;

      expect(cloneCalls()).toHaveLength(1);
    });
  });

  describe('cancellation', () => {
    it('passes ctx.cancelSignal through to the git child process', async () => {
      mockExistsSync.mockReturnValue(false);
      const ac = new AbortController();

      await cloneRepo(makeCtx({ cancelSignal: ac.signal }));

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.any(Array),
        expect.objectContaining({ signal: ac.signal }),
        expect.any(Function),
      );
    });

    it('rejects promptly without spawning git when the signal is already aborted', async () => {
      mockExistsSync.mockReturnValue(false);
      const ac = new AbortController();
      ac.abort();

      await expect(cloneRepo(makeCtx({ cancelSignal: ac.signal })))
        .rejects.toThrow('Git command aborted by cancellation');
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('aborts an in-flight git process and rejects with a cancellation error', async () => {
      mockExistsSync.mockReturnValue(false);
      const ac = new AbortController();

      // Simulate node's execFile signal behavior: child hangs until abort,
      // then the callback fires with an AbortError.
      mockExecFile.mockImplementation((_f: string, _a: string[], opts: { signal?: AbortSignal }, cb: ExecFileCb) => {
        opts.signal?.addEventListener('abort', () => {
          const err: Error & { code?: string } = new Error('The operation was aborted');
          err.name = 'AbortError';
          err.code = 'ABORT_ERR';
          cb(err as Error & { code: string }, '', '');
        }, { once: true });
      });

      const done = cloneRepo(makeCtx({ cancelSignal: ac.signal }));
      const assertion = expect(done).rejects.toThrow('Git command aborted by cancellation');

      ac.abort();
      await assertion;
      // Only the first git command was ever spawned — the sequence stopped on cancel
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it('does not retry a clone that was cancelled mid-flight', async () => {
      vi.useFakeTimers();
      try {
        mockExistsSync.mockReturnValue(false);
        const ac = new AbortController();

        // First call: DNS failure. Abort before the backoff sleep finishes.
        mockExecFile.mockImplementationOnce(execFileFail(128, DNS_STDERR));

        const done = cloneRepo(makeCtx({ cancelSignal: ac.signal }));
        const assertion = expect(done).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(0);
        ac.abort();
        await vi.runAllTimersAsync();
        await assertion;

        // Retry loop must not spawn another git process after cancellation
        expect(cloneCalls().length).toBeLessThanOrEqual(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('checks out specific branch when provided', async () => {
    mockExistsSync.mockReturnValue(false);

    await cloneRepo(makeCtx({ branch: 'develop' }));

    expect(gitCommands()).toContainEqual('git checkout develop');
  });

  it('checks out specific commit when provided', async () => {
    mockExistsSync.mockReturnValue(false);

    await cloneRepo(makeCtx({ commitHash: 'abc123' }));

    expect(gitCommands()).toContainEqual('git checkout abc123');
  });

  it('on existing repo with branch, checks out and pulls', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('/.git'));

    await cloneRepo(makeCtx({ branch: 'feature' }));

    const commands = gitCommands();
    expect(commands).toContainEqual('git fetch --all --prune');
    expect(commands).toContainEqual('git checkout feature');
    expect(commands).toContainEqual('git pull origin feature');
  });

  it('on existing repo with commitHash, checks out commit', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('/.git'));

    await cloneRepo(makeCtx({ commitHash: 'deadbeef' }));

    const commands = gitCommands();
    expect(commands).toContainEqual('git fetch --all --prune');
    expect(commands).toContainEqual('git checkout deadbeef');
  });

  it('scrubs the access token from .git/config after a fresh clone', async () => {
    mockExistsSync.mockReturnValue(false);

    await cloneRepo(makeCtx({
      cloneUrl: 'https://x-token-auth:ATATT_secret@bitbucket.org/org/repo.git',
    }));

    const commands = gitCommands();
    expect(commands).toContainEqual('git remote set-url origin https://bitbucket.org/org/repo.git');
    expect(commands.some((c) => c.includes('ATATT_secret') && c.startsWith('git remote'))).toBe(false);
  });

  it('does not rewrite the remote when the clone URL has no credentials', async () => {
    mockExistsSync.mockReturnValue(false);

    await cloneRepo(makeCtx({ cloneUrl: 'https://github.com/org/repo.git' }));

    expect(gitCommands().some((c) => c.startsWith('git remote set-url'))).toBe(false);
  });

  it('restores auth on the remote before fetching an existing repo', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('/.git'));

    await cloneRepo(makeCtx({
      cloneUrl: 'https://x-token-auth:ATATT_secret@bitbucket.org/org/repo.git',
    }));

    const commands = gitCommands();
    const setAuth = commands.indexOf('git remote set-url origin https://x-token-auth:ATATT_secret@bitbucket.org/org/repo.git');
    const fetch = commands.indexOf('git fetch --all --prune');
    const setClean = commands.indexOf('git remote set-url origin https://bitbucket.org/org/repo.git');
    expect(setAuth).toBeGreaterThanOrEqual(0);
    expect(setAuth).toBeLessThan(fetch);
    expect(setClean).toBeGreaterThan(fetch);
  });
});

describe('stripCredentials', () => {
  it('removes user:token@ from https URLs', () => {
    expect(stripCredentials('https://x-token-auth:ATATT_secret@bitbucket.org/org/repo.git'))
      .toBe('https://bitbucket.org/org/repo.git');
  });

  it('leaves credential-free https URLs unchanged', () => {
    expect(stripCredentials('https://github.com/org/repo.git'))
      .toBe('https://github.com/org/repo.git');
  });

  it('leaves ssh URLs unchanged', () => {
    expect(stripCredentials('git@github.com:org/repo.git'))
      .toBe('git@github.com:org/repo.git');
  });
});

// ── runCloneStep ───────────────────────────────────────────────────

describe('runCloneStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockExecFile.mockImplementation(execFileOk);
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

  it('chowns the repo base dir to scanner so the analyzer can write the profile', async () => {
    mockExistsSync.mockReturnValue(false);

    const ctx = makeCtx({ repoName: 'matrix', repoBaseDir: '/workspace/src-1/matrix' });
    await runCloneStep({ ctx, prev: {} });

    expect(mockChownSync).toHaveBeenCalledWith('/workspace/src-1/matrix', expect.any(Number), expect.any(Number));
  });

  it('resolves authenticated clone URL when credentials exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const creds = { provider: 'github', token: 'ghp_secret', email: undefined };
    mockGetRepoCloneCredentials.mockResolvedValue(creds);
    mockBuildAuthCloneUrl.mockReturnValue('https://x-access-token:ghp_secret@github.com/org/repo.git');

    const ctx = makeCtx();
    const originalCloneUrl = ctx.cloneUrl;
    const result = await runCloneStep({ ctx, prev: {} });

    // Credentials are resolved by the unique repository_id (passed through), not by name
    expect(mockGetRepoCloneCredentials).toHaveBeenCalledWith(ctx.repoName, ctx.repoUrl, 42);
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
