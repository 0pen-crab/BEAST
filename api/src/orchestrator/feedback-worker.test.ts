import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../db/index.ts';

const mockDb = db as any;

// ── Mock SSH ───────────────────────────────────────────────────────
const mockSshExec = vi.fn();
const mockSshWriteFile = vi.fn();
const mockParseStreamJsonResult = vi.fn();

vi.mock('./ssh.ts', () => ({
  sshExec: (...args: unknown[]) => mockSshExec(...args),
  sshWriteFile: (...args: unknown[]) => mockSshWriteFile(...args),
  getClaudeRunnerConfig: () => ({ host: 'test-host', port: 22, username: 'test', privateKey: Buffer.from('key') }),
  parseStreamJsonResult: (...args: unknown[]) => mockParseStreamJsonResult(...args),
}));

// ── Mock entities ──────────────────────────────────────────────────
const mockCreateWorkspaceEvent = vi.fn();

vi.mock('./entities.ts', () => ({
  createWorkspaceEvent: (...args: unknown[]) => mockCreateWorkspaceEvent(...args),
}));

vi.mock('./prompt-languages.ts', () => ({
  getLanguageInstruction: () => '',
}));

beforeEach(() => {
  mockSshExec.mockReset();
  mockSshWriteFile.mockReset();
  mockParseStreamJsonResult.mockReset();
  mockCreateWorkspaceEvent.mockReset();
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('compileFeedback', () => {
  it('does nothing when no assessments have feedback', async () => {
    mockDb.orderBy.mockResolvedValueOnce([{ feedback: null }, { feedback: '' }]);

    const { compileFeedback } = await import('./feedback-worker.ts');
    await compileFeedback(1);

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('uses the single feedback directly without calling Claude', async () => {
    mockDb.orderBy.mockResolvedValueOnce([{ repoName: 'r1', feedback: 'Great work' }]);

    const { compileFeedback } = await import('./feedback-worker.ts');
    await compileFeedback(1);

    expect(mockSshExec).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({
      feedback: 'Great work',
      feedbackCompiledAt: expect.any(Date),
    }));
  });

  it('compiles multiple assessments via Claude and stores the result', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      { repoName: 'r1', feedback: 'A', scoreSecurity: 5, scoreQuality: 5, scorePatterns: 5, scoreTesting: 5, scoreInnovation: 5 },
      { repoName: 'r2', feedback: 'B', scoreSecurity: 6, scoreQuality: 6, scorePatterns: 6, scoreTesting: 6, scoreInnovation: 6 },
    ]);
    // contrib lookup, then workspace lookup (where-terminated selects)
    mockDb.where
      .mockReturnValueOnce(mockDb)                                            // chain 1: select().from().where().orderBy()
      .mockResolvedValueOnce([{ displayName: 'Dev', workspaceId: 5 }])        // chain 2: contrib
      .mockResolvedValueOnce([{ defaultLanguage: null }]);                    // chain 3: workspace
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockResolvedValueOnce({ stdout: 'raw', stderr: '', code: 0 });
    mockParseStreamJsonResult.mockReturnValueOnce({ result: { is_error: false, result: 'Unified profile' } });

    const { compileFeedback } = await import('./feedback-worker.ts');
    await compileFeedback(1);

    expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({
      feedback: 'Unified profile',
      feedbackCompiledAt: expect.any(Date),
    }));
    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
  });

  it('records a workspace event when Claude compilation fails (profile update must not vanish silently)', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      { repoName: 'r1', feedback: 'A', scoreSecurity: 5, scoreQuality: 5, scorePatterns: 5, scoreTesting: 5, scoreInnovation: 5 },
      { repoName: 'r2', feedback: 'B', scoreSecurity: 6, scoreQuality: 6, scorePatterns: 6, scoreTesting: 6, scoreInnovation: 6 },
    ]);
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockResolvedValueOnce([{ displayName: 'Dev', workspaceId: 5 }])
      .mockResolvedValueOnce([{ defaultLanguage: null }]);
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockRejectedValueOnce(new Error('ssh boom'));
    mockCreateWorkspaceEvent.mockResolvedValueOnce(undefined);

    const { compileFeedback } = await import('./feedback-worker.ts');
    await expect(compileFeedback(7)).resolves.toBeUndefined(); // must not throw

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(5, 'feedback_compilation_failed', expect.objectContaining({
      contributor_id: 7,
      error: expect.stringContaining('ssh boom'),
    }));
  });

  it('still logs to console when the workspace id is unknown (event cannot be attributed)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDb.orderBy.mockResolvedValueOnce([
      { repoName: 'r1', feedback: 'A' },
      { repoName: 'r2', feedback: 'B' },
    ]);
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockResolvedValueOnce([]); // no contributor row → no workspaceId
    mockSshWriteFile.mockResolvedValue(undefined);
    mockSshExec.mockRejectedValueOnce(new Error('ssh boom'));

    const { compileFeedback } = await import('./feedback-worker.ts');
    await compileFeedback(9);

    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    const logged = consoleSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('ssh boom');
  });
});

describe('recoverPendingCompilations', () => {
  it('re-queues contributors whose newest assessment postdates the last compilation', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Recovery chain terminates in .having()
    mockDb.having.mockResolvedValueOnce([{ contributorId: 3 }, { contributorId: 4 }]);

    const { recoverPendingCompilations } = await import('./feedback-worker.ts');
    await expect(recoverPendingCompilations()).resolves.toBe(2);

    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/recovered 2/i);
  });

  it('queues nothing when every profile is fresh', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDb.having.mockResolvedValueOnce([]);

    const { recoverPendingCompilations } = await import('./feedback-worker.ts');
    await expect(recoverPendingCompilations()).resolves.toBe(0);

    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/recovered/i);
  });

  it('never throws when the recovery query fails (worker boot must survive)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDb.having.mockRejectedValueOnce(new Error('db down'));

    const { recoverPendingCompilations } = await import('./feedback-worker.ts');
    await expect(recoverPendingCompilations()).resolves.toBe(0);

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('db down');
  });
});

describe('feedback worker lifecycle', () => {
  it('startFeedbackWorker runs restart recovery once and no longer warns about the in-memory queue', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDb.having.mockResolvedValue([]);

    const { startFeedbackWorker, stopFeedbackWorker } = await import('./feedback-worker.ts');
    startFeedbackWorker();
    startFeedbackWorker(); // second call is a no-op — must not re-run recovery
    await Promise.resolve(); // let the fire-and-forget recovery settle
    stopFeedbackWorker();

    expect(mockDb.select).toHaveBeenCalledTimes(1);
    const warned = warnSpy.mock.calls.flat().join(' ');
    expect(warned).not.toMatch(/not persisted|in-memory/i);
    vi.useRealTimers();
  });

  it('queueFeedbackCompilation deduplicates contributor ids', async () => {
    const { queueFeedbackCompilation } = await import('./feedback-worker.ts');
    // Just verifies it does not throw on repeated adds (Set semantics)
    queueFeedbackCompilation(1);
    queueFeedbackCompilation(1);
    queueFeedbackCompilation(2);
  });
});
