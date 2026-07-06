import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

// Mock auth middleware so route guards are no-ops in unit tests
vi.mock('../middleware/auth.ts', () => ({
  requireRole: () => async () => {},
}));

vi.mock('../lib/authorize.ts', () => ({
  authorize: vi.fn(async (request: any) => { request.authorized = true; }),
  authorizePublic: vi.fn((request: any) => { request.authorized = true; }),
  authorizeSuperAdmin: vi.fn((request: any) => { request.authorized = true; }),
  ForbiddenError: class ForbiddenError extends Error {
    statusCode = 403;
    constructor(msg = 'Forbidden') { super(msg); }
  },
}));

// Mock the orchestrator/db module (scan CRUD helpers)
const mockCreateScan = vi.fn();
const mockGetScan = vi.fn();
const mockListScans = vi.fn();
vi.mock('../orchestrator/db.ts', () => ({
  createScan: mockCreateScan,
  getScan: mockGetScan,
  listScans: mockListScans,
}));

// Mock the worker-status module so we can assert the global pause is lifted on resume
const mockResumeWorker = vi.fn();
vi.mock('./worker-status.ts', () => ({
  resumeWorker: mockResumeWorker,
}));

// Mock cleanup — cancelling a PAUSED scan must remove partial data from the
// route (no worker failure path will run for it).
const mockCleanupFailedScanData = vi.fn();
vi.mock('../orchestrator/cleanup.ts', () => ({
  cleanupFailedScanData: mockCleanupFailedScanData,
}));

import { db } from '../db/index.ts';
const mockDb = db as any;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('preHandler', async (request) => {
    request.user = { id: 1, username: 'test', role: 'super_admin', displayName: 'Test', mustChangePassword: false };
  });
  const mod = await import('./scans.ts');
  await app.register(mod.scanRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Re-wire the chainable mock so each method returns the mock itself
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

// ── GET /scans ───────────────────────────────────────────────

describe('GET /scans', () => {
  it('returns 200 with list of scans', async () => {
    const scanList = {
      count: 2,
      results: [
        { id: 'abc', status: 'completed', repoName: 'repo-a' },
        { id: 'def', status: 'queued', repoName: 'repo-b' },
      ],
    };
    mockListScans.mockResolvedValueOnce(scanList);

    const res = await app.inject({
      method: 'GET',
      url: '/scans',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(scanList);
  });

  it('passes limit, offset, workspace_id to listScans', async () => {
    mockListScans.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/scans?limit=10&offset=5&workspace_id=3',
    });

    expect(mockListScans).toHaveBeenCalledWith(10, 5, 3, undefined, undefined);
  });

  it('passes status filter to listScans', async () => {
    mockListScans.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/scans?status=running',
    });

    expect(mockListScans).toHaveBeenCalledWith(20, 0, undefined, 'running', undefined);
  });

  it('rejects limit above 500 with 400 (bounded like sibling routes)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/scans?limit=9999',
    });

    expect(res.statusCode).toBe(400);
    expect(mockListScans).not.toHaveBeenCalled();
  });

  it('rejects limit=0 with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/scans?limit=0',
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects negative offset with 400 (no Postgres error → 500)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/scans?offset=-5',
    });

    expect(res.statusCode).toBe(400);
    expect(mockListScans).not.toHaveBeenCalled();
  });

  it('defaults limit to 20 and offset to 0', async () => {
    mockListScans.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/scans',
    });

    expect(mockListScans).toHaveBeenCalledWith(20, 0, undefined, undefined, undefined);
  });

  it('truncates a legacy 10MB scan error to a few KB in list payloads', async () => {
    const hugeError = 'x'.repeat(10 * 1024 * 1024);
    mockListScans.mockResolvedValueOnce({
      count: 1,
      results: [{ id: 'abc', status: 'failed', repoName: 'legacy-repo', error: hugeError }],
    });

    const res = await app.inject({ method: 'GET', url: '/scans' });

    expect(res.statusCode).toBe(200);
    // The whole response — not just the error field — must stay tiny.
    expect(res.rawPayload.length).toBeLessThan(4_096);
    const scan = res.json().results[0];
    expect(scan.error.length).toBeLessThan(2_100);
    expect(scan.error.endsWith('… (truncated)')).toBe(true);
    expect(scan.repoName).toBe('legacy-repo');
  });

  it('leaves small scan errors and null errors untouched in list payloads', async () => {
    mockListScans.mockResolvedValueOnce({
      count: 2,
      results: [
        { id: 'abc', status: 'failed', repoName: 'r', error: 'Cancelled by user' },
        { id: 'def', status: 'completed', repoName: 'r2', error: null },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/scans' });

    expect(res.json().results[0].error).toBe('Cancelled by user');
    expect(res.json().results[1].error).toBeNull();
  });

  it('passes repository_id filter to listScans (repo-page latest-scan lookup)', async () => {
    mockListScans.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/scans?workspace_id=3&repository_id=42&limit=1',
    });

    expect(mockListScans).toHaveBeenCalledWith(1, 0, 3, undefined, 42);
  });
});

// ── POST /scans ──────────────────────────────────────────────

describe('POST /scans', () => {
  const fakeRepo = {
    id: 1,
    name: 'my-repo',
    repoUrl: 'https://github.com/org/my-repo.git',
    teamId: 10,
  };

  function mockRepoLookup(repo: typeof fakeRepo | null) {
    // db.select().from(repositories).where(...) => [repo] or []
    const rows = repo ? [repo] : [];
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    });
  }

  function mockTeamLookup(workspaceId: number) {
    // db.execute(sql`...`) => [{ workspace_id }]
    mockDb.execute.mockResolvedValue([{ workspace_id: workspaceId }]);
  }

  function mockRepoStatusUpdate() {
    // db.update(repositories).set(...).where(...)
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
  }

  it('returns 201 with created scan', async () => {
    const scan = { id: 'new-scan-id', status: 'queued', repoName: 'my-repo' };
    mockRepoLookup(fakeRepo);
    mockTeamLookup(5);
    mockCreateScan.mockResolvedValueOnce(scan);
    mockRepoStatusUpdate();

    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      payload: { repositoryId: 1 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(scan);
  });

  it('returns 404 when repository not found', async () => {
    mockRepoLookup(null);

    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      payload: { repositoryId: 999 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Repository not found');
  });

  it('passes repoName from repository to createScan', async () => {
    const scan = { id: 'id', status: 'queued', repoName: 'my-repo' };
    mockRepoLookup(fakeRepo);
    mockTeamLookup(5);
    mockCreateScan.mockResolvedValueOnce(scan);
    mockRepoStatusUpdate();

    await app.inject({
      method: 'POST',
      url: '/scans',
      payload: { repositoryId: 1 },
    });

    expect(mockCreateScan).toHaveBeenCalledWith(
      expect.objectContaining({ repoName: 'my-repo' }),
    );
  });

  it('passes workspaceId from team lookup to createScan', async () => {
    const scan = { id: 'id', status: 'queued', repoName: 'my-repo' };
    mockRepoLookup(fakeRepo);
    mockTeamLookup(42);
    mockCreateScan.mockResolvedValueOnce(scan);
    mockRepoStatusUpdate();

    await app.inject({
      method: 'POST',
      url: '/scans',
      payload: { repositoryId: 1 },
    });

    expect(mockCreateScan).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 42 }),
    );
  });

  it('passes repositoryId to createScan', async () => {
    const scan = { id: 'id', status: 'queued', repoName: 'my-repo' };
    mockRepoLookup(fakeRepo);
    mockTeamLookup(5);
    mockCreateScan.mockResolvedValueOnce(scan);
    mockRepoStatusUpdate();

    await app.inject({
      method: 'POST',
      url: '/scans',
      payload: { repositoryId: 1 },
    });

    expect(mockCreateScan).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 1 }),
    );
  });

  it('updates repo status to queued after creating scan', async () => {
    const scan = { id: 'id', status: 'queued', repoName: 'my-repo' };
    mockRepoLookup(fakeRepo);
    mockTeamLookup(5);
    mockCreateScan.mockResolvedValueOnce(scan);
    mockRepoStatusUpdate();

    await app.inject({
      method: 'POST',
      url: '/scans',
      payload: { repositoryId: 1 },
    });

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('passes local repoUrl as localPath to createScan', async () => {
    const localRepo = {
      id: 2,
      name: 'uploaded-repo',
      repoUrl: '/workspace/uploads/abc/extracted/uploaded-repo',
      teamId: 10,
    };
    const scan = { id: 'local-scan', status: 'queued', repoName: 'uploaded-repo' };
    mockRepoLookup(localRepo);
    mockTeamLookup(5);
    mockCreateScan.mockResolvedValueOnce(scan);
    mockRepoStatusUpdate();

    await app.inject({
      method: 'POST',
      url: '/scans',
      payload: { repositoryId: 2 },
    });

    expect(mockCreateScan).toHaveBeenCalledWith(
      expect.objectContaining({
        localPath: '/workspace/uploads/abc/extracted/uploaded-repo',
        repoUrl: undefined,
      }),
    );
  });

  it('returns 400 when repositoryId is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── GET /scans/:id ───────────────────────────────────────────

describe('GET /scans/:id', () => {
  it('returns scan by id with steps and module progress', async () => {
    const scan = { id: 'abc-123', status: 'completed', repoName: 'my-repo', workspaceId: 1 };
    mockGetScan.mockResolvedValueOnce(scan);

    // First select: scan_steps (with .orderBy chain)
    // Second select: scan_modules (just .where chain)
    const steps = [{ id: 1, stepName: 'clone', status: 'completed' }];
    const modules = [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'pending' },
    ];
    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(steps),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(modules),
        }),
      });

    const res = await app.inject({
      method: 'GET',
      url: '/scans/11111111-1111-4111-8111-111111111111',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ...scan,
      steps,
      moduleProgress: { total: 3, completed: 2 },
    });
  });

  it('returns moduleProgress {0,0} when scan has no modules', async () => {
    const scan = { id: 'abc-123', status: 'queued', repoName: 'my-repo', workspaceId: 1 };
    mockGetScan.mockResolvedValueOnce(scan);

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    const res = await app.inject({ method: 'GET', url: '/scans/11111111-1111-4111-8111-111111111111' });

    expect(res.statusCode).toBe(200);
    expect(res.json().moduleProgress).toEqual({ total: 0, completed: 0 });
  });

  it('returns 404 when scan not found', async () => {
    mockGetScan.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/scans/99999999-9999-4999-8999-999999999999',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Scan not found');
  });

  /** Wire the two chained selects (scan_steps, scan_modules) for GET /scans/:id. */
  function mockStepsAndModules(steps: unknown[], modules: unknown[] = []) {
    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(steps),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(modules),
        }),
      });
  }

  it('replaces staged-plan fields in step output with markers (import step ≈10MB)', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc-123', status: 'paused', repoName: 'r', workspaceId: 1 });
    const steps = [{
      id: 4,
      stepName: 'import',
      status: 'completed',
      input: { repoPath: '/tmp/r' },
      output: {
        repositoryId: 7,
        findingsPrepared: 366,
        preparedFindings: Array.from({ length: 366 }, (_, i) => ({ tempId: i, title: 'SQLi', codeSnippet: 'x'.repeat(20_000), fingerprint: 'f' })),
        preparedTests: [{ key: 'gitleaks' }],
        resultFiles: [{ key: 'gitleaks', content_b64: 'A'.repeat(1024 * 1024) }],
        analyzerAssessments: [{ email: 'a@b.c' }],
      },
    }];
    mockStepsAndModules(steps);

    const res = await app.inject({ method: 'GET', url: '/scans/11111111-1111-4111-8111-111111111111' });

    expect(res.statusCode).toBe(200);
    // Detail response must be a few KB, not 21–30MB.
    expect(res.rawPayload.length).toBeLessThan(60_000);
    const step = res.json().steps[0];
    expect(step.output.preparedFindings).toBe('<omitted: 366 items>');
    expect(step.output.preparedTests).toBe('<omitted: 1 items>');
    expect(step.output.resultFiles).toBe('<omitted: 1 items>');
    expect(step.output.analyzerAssessments).toBe('<omitted: 1 items>');
    // Non-heavy fields survive so the dashboard step view keeps working.
    expect(step.output.findingsPrepared).toBe(366);
    expect(step.input).toEqual({ repoPath: '/tmp/r' });
  });

  it('hard-caps a step output that is huge without staged-plan keys', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc-123', status: 'completed', repoName: 'r', workspaceId: 1 });
    mockStepsAndModules([{
      id: 2,
      stepName: 'security-scan',
      status: 'completed',
      input: null,
      output: { rawLog: 'z'.repeat(5 * 1024 * 1024) },
    }]);

    const res = await app.inject({ method: 'GET', url: '/scans/11111111-1111-4111-8111-111111111111' });

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBeLessThan(120_000);
    const step = res.json().steps[0];
    expect(step.output['<truncated>']).toContain('capped at 50000');
    expect(typeof step.output.preview).toBe('string');
  });

  it('passes normal small step inputs/outputs through unchanged', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc-123', status: 'completed', repoName: 'r', workspaceId: 1 });
    const steps = [{
      id: 1,
      stepName: 'clone',
      status: 'completed',
      input: { branch: 'main' },
      output: { commitHash: 'deadbeef', aiUsage: { inputTokens: 10, outputTokens: 5 } },
    }];
    mockStepsAndModules(steps);

    const res = await app.inject({ method: 'GET', url: '/scans/11111111-1111-4111-8111-111111111111' });

    expect(res.statusCode).toBe(200);
    expect(res.json().steps).toEqual(steps);
  });
});

// ── GET /scans/stats ─────────────────────────────────────────

describe('GET /scans/stats', () => {
  it('returns scan statistics', async () => {
    const stats = {
      total: 10,
      queued: 2,
      running: 1,
      completed: 6,
      failed: 1,
      avg_duration_sec: 120,
      earliest_active: null,
    };
    // Mock: db.select({...}).from(scans).where(undefined)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([stats]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/scans/stats',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(stats);
  });

  it('filters stats by workspace_id', async () => {
    const stats = { total: 0, queued: 0, running: 0, completed: 0, failed: 0, avg_duration_sec: null, earliest_active: null };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([stats]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/scans/stats?workspace_id=3',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(stats);
    expect(mockDb.select).toHaveBeenCalled();
  });
});

// ── DELETE /scans/:id ────────────────────────────────────────

describe('DELETE /scans/:id', () => {
  it('returns 404 when scan not found', async () => {
    mockGetScan.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'DELETE',
      url: '/scans/99999999-9999-4999-8999-999999999999',
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when scan is not queued', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'running', workspaceId: 1 });

    const res = await app.inject({
      method: 'DELETE',
      url: '/scans/11111111-1111-4111-8111-111111111111',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Only queued scans');
  });

  it('deletes queued scan successfully', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'queued', workspaceId: 1 });
    // Mock db.delete(scans).where(...)
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/scans/11111111-1111-4111-8111-111111111111',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });
});

// ── POST /scans/:id/resume ──────────────────────────────────

describe('POST /scans/:id/resume', () => {
  it('returns 404 when scan not found', async () => {
    mockGetScan.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/scans/99999999-9999-4999-8999-999999999999/resume',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Scan not found');
  });

  it('returns 409 when scan is not paused', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'completed', workspaceId: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/11111111-1111-4111-8111-111111111111/resume',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Only paused scans');
  });

  it('clears resumes_at and returns 200 for paused scan', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'paused', workspaceId: 1, resumesAt: new Date() });
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/11111111-1111-4111-8111-111111111111/resume',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ resumed: true });
    expect(setFn).toHaveBeenCalledWith({ resumesAt: null, error: null });
  });

  it('lifts the global worker pause so the poller actually picks the scan up', async () => {
    // The rate-limit hook pauses the worker globally (in-memory flag); clearing only
    // the scan's resumes_at is not enough because pollForWork() bails on isWorkerPaused().
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'paused', workspaceId: 1, resumesAt: new Date() });
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/11111111-1111-4111-8111-111111111111/resume',
    });

    expect(res.statusCode).toBe(200);
    expect(mockResumeWorker).toHaveBeenCalledTimes(1);
  });

  it('does not lift the worker pause when the scan cannot be resumed', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'completed', workspaceId: 1 });

    await app.inject({ method: 'POST', url: '/scans/11111111-1111-4111-8111-111111111111/resume' });

    expect(mockResumeWorker).not.toHaveBeenCalled();
  });
});

// ── POST /scans/:id/cancel ──────────────────────────────────

describe('POST /scans/:id/cancel', () => {
  it('returns 404 when scan not found', async () => {
    mockGetScan.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/scans/99999999-9999-4999-8999-999999999999/cancel',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Scan not found');
  });

  it('returns 409 when scan is not active', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'completed', workspaceId: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/11111111-1111-4111-8111-111111111111/cancel',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Scan is not active');
  });

  it('cancels a running scan', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'running', repositoryId: 1, workspaceId: 1 });
    // Mock db.update — called for both scan status and repo status
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/11111111-1111-4111-8111-111111111111/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: true });
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('cancels a queued scan', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'queued', workspaceId: 1 });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/11111111-1111-4111-8111-111111111111/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: true });
  });

  it('does NOT run cleanup for a running scan (worker failure path owns it)', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'running', repositoryId: 1, workspaceId: 1 });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await app.inject({ method: 'POST', url: '/scans/11111111-1111-4111-8111-111111111111/cancel' });

    expect(mockCleanupFailedScanData).not.toHaveBeenCalled();
  });

  it('cancels a paused scan (no active pipeline to abort)', async () => {
    mockGetScan.mockResolvedValueOnce({
      id: 'abc', status: 'paused', repositoryId: 7, workspaceId: 1,
      repoName: 'repo-x', resumesAt: new Date('2099-01-01T00:00:00Z'),
    });
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/11111111-1111-4111-8111-111111111111/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: true });

    // Marked failed with the human reason + resumes_at cleared so no poller
    // ever tries to pick it back up.
    const scanSet = setFn.mock.calls.find(c => c[0]?.status === 'failed' && 'error' in c[0]);
    expect(scanSet).toBeDefined();
    expect(scanSet![0]).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'Cancelled by user',
      resumesAt: null,
    }));

    // Repo status released exactly like the worker failure path does
    // (two updates: scans row + repositories row).
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it('runs cleanupFailedScanData for a cancelled paused scan (worker will not)', async () => {
    mockGetScan.mockResolvedValueOnce({
      id: 'abc', status: 'paused', repositoryId: 7, workspaceId: 3, repoName: 'repo-x',
    });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({ method: 'POST', url: '/scans/11111111-1111-4111-8111-111111111111/cancel' });

    expect(res.statusCode).toBe(200);
    expect(mockCleanupFailedScanData).toHaveBeenCalledTimes(1);
    expect(mockCleanupFailedScanData).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
      repoName: 'repo-x',
      workspaceId: 3,
    });
  });
});

// ── POST /scans/cancel-all ──────────────────────────────────

describe('POST /scans/cancel-all', () => {
  it('cancels all active scans and returns count', async () => {
    const cancelled = [{ id: 'a' }, { id: 'b' }];
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(cancelled),
        }),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/cancel-all',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: 2 });
  });

  it('filters by workspace_id when provided', async () => {
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'x' }]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/cancel-all',
      payload: { workspace_id: 5 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: 1 });
    expect(mockDb.update).toHaveBeenCalled();
  });
});

// ── UUID param validation ────────────────────────────────────
// Non-UUID :id used to reach the uuid column and blow up with
// Postgres 22P02 → 500. Must be a schema-level 400 instead.

describe('UUID validation on /scans/:id routes', () => {
  const cases: Array<[string, string]> = [
    ['GET', '/scans/not-a-uuid'],
    ['DELETE', '/scans/not-a-uuid'],
    ['POST', '/scans/not-a-uuid/cancel'],
    ['POST', '/scans/not-a-uuid/resume'],
    ['GET', '/scans/not-a-uuid/steps/gitleaks/artifacts'],
    ['GET', '/scans/not-a-uuid/steps/gitleaks/artifacts/report.json'],
  ];

  for (const [method, url] of cases) {
    it(`${method} ${url} returns 400, not 500`, async () => {
      const res = await app.inject({ method: method as any, url });
      expect(res.statusCode).toBe(400);
      expect(mockGetScan).not.toHaveBeenCalled();
    });
  }
});

// ── Artifact path traversal ──────────────────────────────────

describe('scan artifact routes reject path traversal', () => {
  const SCAN_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    mockGetScan.mockResolvedValue({ id: SCAN_ID, status: 'completed', workspaceId: 1 });
  });

  it('rejects stepName containing ".." on the listing route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scans/${SCAN_ID}/steps/${encodeURIComponent('step..name')}/artifacts`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid');
  });

  it('never resolves a literal ".." step segment (router collapses it → 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scans/${SCAN_ID}/steps/../artifacts`,
    });

    expect([400, 404]).toContain(res.statusCode);
  });

  it('rejects stepName containing an encoded slash on the listing route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scans/${SCAN_ID}/steps/${encodeURIComponent('../../etc')}/artifacts`,
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a filename containing ".." on the download route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scans/${SCAN_ID}/steps/gitleaks/artifacts/${encodeURIComponent('report..json..')}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid');
  });

  it('never routes a slash-containing filename to the handler (router 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scans/${SCAN_ID}/steps/gitleaks/artifacts/${encodeURIComponent('../../../../etc/passwd')}`,
    });

    // find-my-way refuses multi-segment params — either way it must not be 200/500
    expect([400, 404]).toContain(res.statusCode);
  });

  it('rejects backslash-based traversal in stepName on the download route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scans/${SCAN_ID}/steps/${encodeURIComponent('..\\..\\etc')}/artifacts/${encodeURIComponent('passwd')}`,
    });

    expect(res.statusCode).toBe(400);
  });

  it('still serves a well-formed stepName/filename pair (404 when file absent)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scans/${SCAN_ID}/steps/gitleaks/artifacts/report.json`,
    });

    // Path is valid — only the file genuinely does not exist on disk.
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Artifact not found' });
  });
});
