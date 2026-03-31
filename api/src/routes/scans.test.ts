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

// Mock the orchestrator/db module (scan CRUD helpers)
const mockCreateScan = vi.fn();
const mockGetScan = vi.fn();
const mockListScans = vi.fn();
vi.mock('../orchestrator/db.ts', () => ({
  createScan: mockCreateScan,
  getScan: mockGetScan,
  listScans: mockListScans,
}));

import { db } from '../db/index.ts';
const mockDb = db as any;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
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

    expect(mockListScans).toHaveBeenCalledWith(10, 5, 3, undefined);
  });

  it('passes status filter to listScans', async () => {
    mockListScans.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/scans?status=running',
    });

    expect(mockListScans).toHaveBeenCalledWith(20, 0, undefined, 'running');
  });

  it('caps limit at 500', async () => {
    mockListScans.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/scans?limit=9999',
    });

    expect(mockListScans).toHaveBeenCalledWith(500, 0, undefined, undefined);
  });

  it('defaults limit to 20 and offset to 0', async () => {
    mockListScans.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/scans',
    });

    expect(mockListScans).toHaveBeenCalledWith(20, 0, undefined, undefined);
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
  it('returns scan by id with steps', async () => {
    const scan = { id: 'abc-123', status: 'completed', repoName: 'my-repo' };
    mockGetScan.mockResolvedValueOnce(scan);

    // Mock scanSteps query: db.select().from(scanSteps).where(...).orderBy(...)
    const steps = [{ id: 1, stepName: 'clone', status: 'completed' }];
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(steps),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/scans/abc-123',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...scan, steps });
  });

  it('returns 404 when scan not found', async () => {
    mockGetScan.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/scans/nonexistent',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Scan not found');
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
      url: '/scans/nonexistent',
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when scan is not queued', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'running' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/scans/abc',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Only queued scans');
  });

  it('deletes queued scan successfully', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'queued' });
    // Mock db.delete(scans).where(...)
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/scans/abc',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });
});

// ── POST /scans/:id/cancel ──────────────────────────────────

describe('POST /scans/:id/cancel', () => {
  it('returns 404 when scan not found', async () => {
    mockGetScan.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/scans/nonexistent/cancel',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Scan not found');
  });

  it('returns 409 when scan is not active', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'completed' });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/abc/cancel',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Scan is not active');
  });

  it('cancels a running scan', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'running', repositoryId: 1 });
    // Mock db.update — called for both scan status and repo status
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/abc/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: true });
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('cancels a queued scan', async () => {
    mockGetScan.mockResolvedValueOnce({ id: 'abc', status: 'queued' });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/scans/abc/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: true });
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
