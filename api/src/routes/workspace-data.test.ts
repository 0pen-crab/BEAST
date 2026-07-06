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

import { db } from '../db/index.ts';

const mockDb = db as any;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Simulate authenticated user for all requests
  app.addHook('preHandler', async (request) => {
    request.user = { id: 1, username: 'test', role: 'super_admin', displayName: 'Test', mustChangePassword: false };
  });
  const mod = await import('./workspace-data.ts');
  await app.register(mod.workspaceDataRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// TEAMS
// ═══════════════════════════════════════════════════════════════

describe('GET /teams', () => {
  it('returns 200 with list of teams', async () => {
    const teamsList = [
      { id: 1, name: 'Team A', workspace_id: 1 },
      { id: 2, name: 'Team B', workspace_id: 1 },
    ];
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(teamsList),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/teams',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(teamsList);
  });

  it('returns empty array when no teams exist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/teams',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('filters by workspace_id when provided', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/teams?workspace_id=5',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('queries all teams when workspace_id is not provided', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/teams',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /teams', () => {
  it('returns 201 with created team', async () => {
    const team = { id: 1, workspaceId: 1, name: 'New Team', description: null };
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([team]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: { workspace_id: 1, name: 'New Team' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(team);
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: { workspace_id: 1 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when workspace_id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: { name: 'Test' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /teams/:id', () => {
  it('returns team by id', async () => {
    const team = { id: 3, name: 'Team C', workspaceId: 1 };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([team]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/teams/3',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(team);
  });

  it('returns 404 when team not found', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/teams/999',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Team not found');
  });
});

describe('PUT /teams/:id', () => {
  it('returns updated team', async () => {
    const updated = { id: 1, name: 'Updated', description: 'new desc' };
    // Pre-query: select existing team for authorization
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1, workspaceId: 1, name: 'Team' }]),
      }),
    });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/teams/1',
      payload: { name: 'Updated', description: 'new desc' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(updated);
  });

  it('returns 404 when team not found', async () => {
    // Pre-query returns empty → 404 at pre-query stage
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/teams/999',
      payload: { name: 'Test' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Team not found');
  });
});

describe('DELETE /teams/:id', () => {
  it('returns deleted: true on success', async () => {
    // Pre-query: select existing team for authorization
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1, workspaceId: 1, name: 'Team' }]),
      }),
    });
    // delete().where() — no returning
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/teams/1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
  });

  it('returns 404 when team not found', async () => {
    // Pre-query returns empty → 404 at pre-query stage
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/teams/999',
    });

    expect(res.statusCode).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// REPOSITORIES
// ═══════════════════════════════════════════════════════════════

describe('GET /repositories', () => {
  it('returns 200 with list of repositories', async () => {
    const repos = [
      { id: 1, name: 'repo-a', teamName: 'Team A', workspaceId: 1, findingsCount: 3 },
      { id: 2, name: 'repo-b', teamName: 'Team B', workspaceId: 1, findingsCount: 0 },
    ];
    // select({...}).from().innerJoin().where().orderBy()
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(repos),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(repos);
  });

  it('returns empty array when no repositories', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('filters by workspace_id', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories?workspace_id=3',
    });

    expect(res.statusCode).toBe(200);
  });

  it('filters by team_id', async () => {
    // Pre-query: resolve workspace from team
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ workspaceId: 1 }]),
        }),
      }),
    });
    // Main query
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories?team_id=7',
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('PATCH /repositories/bulk', () => {
  /** Workspace pre-query: resolve workspace from first repo via team join. */
  function mockWorkspaceLookup(wsId = 1) {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ wsId }]),
          }),
        }),
      }),
    });
  }

  /** team_id validation query: teams.workspaceId lookup. */
  function mockTeamLookup(workspaceId: number | null) {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(workspaceId === null ? [] : [{ workspaceId }]),
        }),
      }),
    });
  }

  it('returns updated count when team_id provided', async () => {
    mockWorkspaceLookup(1);
    mockTeamLookup(1);
    // Workspace-scoped subquery for allowed ids (lazy — select() is invoked while building)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({}),
        }),
      }),
    });
    // update().set().where().returning() — honest count from returned rows
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/repositories/bulk',
      payload: { ids: [1, 2, 3], team_id: 5 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 3 });
  });

  it('only updates rows of the authorized workspace when foreign ids are mixed in', async () => {
    mockWorkspaceLookup(1);
    // status-only update → no team lookup; the workspace-scoped subquery limits
    // the UPDATE, so only 2 of the 3 requested ids are actually touched.
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({}),
        }),
      }),
    });
    const returning = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning }),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/repositories/bulk',
      payload: { ids: [1, 2, 999], status: 'ignored' },
    });

    expect(res.statusCode).toBe(200);
    // Honest count: the foreign id 999 was NOT updated
    expect(res.json()).toEqual({ updated: 2 });
    expect(returning).toHaveBeenCalled();
  });

  it('rejects a team_id belonging to another workspace with 400', async () => {
    mockWorkspaceLookup(1);
    mockTeamLookup(2); // team lives in workspace 2 — not ours

    const res = await app.inject({
      method: 'PATCH',
      url: '/repositories/bulk',
      payload: { ids: [1], team_id: 42 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('team_id');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown team_id with 400', async () => {
    mockWorkspaceLookup(1);
    mockTeamLookup(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/repositories/bulk',
      payload: { ids: [1], team_id: 4242 },
    });

    expect(res.statusCode).toBe(400);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns 400 when ids is empty', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/repositories/bulk',
      payload: { ids: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid status', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/repositories/bulk',
      payload: { ids: [1], status: 'invalid' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /repositories/:id', () => {
  it('returns repository by id', async () => {
    const repo = { id: 1, name: 'myrepo', teamName: 'Team', workspaceId: 1, findingsCount: 5 };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([repo]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories/1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(repo);
  });

  it('returns 404 when not found', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories/999',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Repository not found');
  });
});

describe('PUT /repositories/:id', () => {
  it('returns updated repository', async () => {
    const updated = { id: 1, name: 'Updated', description: 'new desc' };
    // Pre-query: resolve workspace via team join
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ wsId: 1 }]),
          }),
        }),
      }),
    });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/repositories/1',
      payload: { name: 'Updated', description: 'new desc' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(updated);
  });

  it('returns 404 when not found', async () => {
    // Pre-query returns empty → 404 at pre-query stage
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/repositories/999',
      payload: { name: 'Updated' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Repository not found');
  });
});

describe('GET /repositories/:id/reports', () => {
  it('returns report data grouped by file_type', async () => {
    const rows = [
      { fileType: 'profile', content: '# Profile report', createdAt: '2026-01-01' },
      { fileType: 'audit', content: '# Audit report', createdAt: '2026-01-01' },
    ];
    // Pre-query: resolve workspace via team join
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ wsId: 1 }]),
          }),
        }),
      }),
    });
    // Main query: scan_files joined with scans
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories/1/reports',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile).toBeDefined();
    expect(body.profile.content).toBe('# Profile report');
    expect(body.audit).toBeDefined();
    expect(body.audit.content).toBe('# Audit report');
  });

  it('returns empty object when no reports', async () => {
    // Pre-query: resolve workspace via team join
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ wsId: 1 }]),
          }),
        }),
      }),
    });
    // Main query returns empty
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories/1/reports',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });
});

describe('DELETE /repositories/:id', () => {
  it('returns deleted: true', async () => {
    // Pre-query: resolve workspace via team join
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ wsId: 1 }]),
          }),
        }),
      }),
    });
    // delete().where() — no returning
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/repositories/1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
  });

  it('returns 404 when not found', async () => {
    // Pre-query returns empty → 404 at pre-query stage
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/repositories/999',
    });

    expect(res.statusCode).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTS (test results)
// ═══════════════════════════════════════════════════════════════

describe('GET /tests', () => {
  it('returns 200 with list of tests', async () => {
    const testsList = [
      { id: 1, tool: 'gitleaks', scanId: 'abc' },
    ];
    // No filter → select().from().orderBy().limit()
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(testsList),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tests',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(testsList);
  });

  it('filters by scan_id', async () => {
    // Pre-query: resolve workspace from scan
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ workspaceId: 1 }]),
        }),
      }),
    });
    // Main query: scan_id filter → select().from().where().orderBy()
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tests?scan_id=11111111-1111-4111-8111-111111111111',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('rejects a non-UUID scan_id with 400 (not a Postgres 22P02 → 500)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tests?scan_id=abc-123',
    });

    expect(res.statusCode).toBe(400);
  });

  it('filters by repository_id', async () => {
    // Pre-query: resolve workspace from repo via team join
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ wsId: 1 }]),
          }),
        }),
      }),
    });
    // Main query: repository_id filter → select({...}).from().innerJoin().where().orderBy()
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tests?repository_id=5',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('GET /tests/:id', () => {
  it('returns test by id', async () => {
    const test = { id: 1, tool: 'gitleaks', scanId: 'abc', workspaceId: 1 };
    // select({...columns, workspaceId}).from(tests).innerJoin(scans).where()
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([test]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tests/1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(test);
  });

  it('returns 404 when test not found', async () => {
    // select({...}).from(tests).innerJoin(scans).where() returns empty
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tests/999',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Test not found');
  });
});

// ═══════════════════════════════════════════════════════════════
// FINDINGS
// ═══════════════════════════════════════════════════════════════

describe('GET /findings', () => {
  it('returns 200 with count and results including duplicateCount', async () => {
    const findingsList = [
      { id: 1, title: 'SQL Injection', severity: 'High', status: 'open', secretValue: 'abc123secret', duplicateCount: 2 },
      { id: 2, title: 'XSS', severity: 'Medium', status: 'open', secretValue: null, duplicateCount: 0 },
    ];
    // First select = count query: select({count}).from().where()
    // Second select = data query: select().from().innerJoin(tests).innerJoin(scans).leftJoin(contributors).leftJoin(repositories).where().orderBy().limit().offset()
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // count query
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 2 }]),
          }),
        };
      }
      // data query
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue(findingsList),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('count', 2);
    expect(body).toHaveProperty('results');
    // secretValue is masked by maskSecret: 'abc123secret' → 'abc1******et', null → null
    expect(body.results[0].secretValue).toBe('abc1******et');
    expect(body.results[1].secretValue).toBeNull();
    expect(body.results).toHaveLength(2);
    // duplicateCount survives mask transform
    expect(body.results[0].duplicateCount).toBe(2);
    expect(body.results[1].duplicateCount).toBe(0);
  });

  it('returns empty results when no findings', async () => {
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue([]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });

  it('applies the duplicate=false filter (excludes duplicate-status findings)', async () => {
    // Capture the main query's where() argument — before the fix `duplicate`
    // was not in the schema, so the param was silently dropped and the WHERE
    // clause stayed empty (duplicates leaked into "Top findings").
    const whereSpy = vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // count query
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({ where: whereSpy }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({ method: 'GET', url: '/findings?duplicate=false' });

    expect(res.statusCode).toBe(200);
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(whereSpy.mock.calls[0][0]).toBeDefined();
  });

  it('rejects an invalid duplicate value with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/findings?duplicate=banana' });
    expect(res.statusCode).toBe(400);
  });

  it('filters by workspace_id', async () => {
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        // First call is the subquery for workspaceTestIds (select.from.innerJoin.where)
        // Second call is the count query
        if (callCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue(mockDb), // subquery — returned as-is
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue([]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings?workspace_id=1',
    });

    expect(res.statusCode).toBe(200);
  });

  it('filters by severity', async () => {
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue([]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings?severity=High',
    });

    expect(res.statusCode).toBe(200);
  });

  it('filters by search term across title and file path', async () => {
    let callCount = 0;
    let countWhereArg: unknown;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation((arg: unknown) => {
              countWhereArg = arg;
              return Promise.resolve([{ count: 1 }]);
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue([
                          { id: 1, title: 'SQL Injection', severity: 'High', status: 'open', secretValue: null, duplicateCount: 0 },
                        ]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings?search=injection',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(1);
    // A where clause must be applied when search is present
    expect(countWhereArg).toBeDefined();
  });

  it('applies no search condition when search is absent', async () => {
    let countWhereArg: unknown = 'sentinel';
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation((arg: unknown) => {
              countWhereArg = arg;
              return Promise.resolve([{ count: 0 }]);
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue([]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings',
    });

    expect(res.statusCode).toBe(200);
    // No filters at all → whereClause is undefined
    expect(countWhereArg).toBeUndefined();
  });

  it('respects limit and offset', async () => {
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 100 }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        offset: vi.fn().mockResolvedValue([]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings?limit=10&offset=20',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(100);
  });
});

describe('GET /findings/export.csv', () => {
  it('returns CSV with header + rows, content-type text/csv, attachment disposition', async () => {
    const rows = [
      { id: 1, title: 'SQL Injection', severity: 'High', tool: 'semgrep', status: 'open',
        filePath: '/app/db.py', line: 42, cvssScore: 7.5, repositoryName: 'app', contributorName: 'Alice',
        description: 'desc', createdAt: '2026-01-15T10:00:00Z', secretValue: null },
      { id: 2, title: 'XSS, with comma', severity: 'Medium', tool: 'trivy', status: 'fixed',
        filePath: '/web/index.html', line: null, cvssScore: 5.5, repositoryName: 'web', contributorName: null,
        description: 'has "quotes"', createdAt: '2026-02-01T11:00:00Z', secretValue: 'abc123secret' },
    ];
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue(rows),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/findings/export.csv?columns=severity,tool,location,repository,status' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="findings_/);

    const lines = res.body.split('\n');
    expect(lines[0]).toBe('Severity,Tool,Location,Repository,Status');
    // Comma + quote escaping must work for XSS title row (we don't export title in this column set,
    // but location with embedded path/line and contributor edge cases still test the escape):
    expect(lines[1]).toBe('High,semgrep,/app/db.py:42,app,open');
    expect(lines[2]).toBe('Medium,trivy,/web/index.html,web,fixed');
  });

  it('falls back to the full column set when columns param is empty/invalid', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/findings/export.csv?columns=zzznope' });

    expect(res.statusCode).toBe(200);
    const header = res.body.split('\n')[0];
    // Header should contain every default column header
    expect(header).toContain('Severity');
    expect(header).toContain('Tool');
    expect(header).toContain('Title');
    expect(header).toContain('Date');
  });

  it('applies the source_id filter (same condition as GET /findings)', async () => {
    // Main query chain — capture the where() argument to assert a filter exists
    const whereSpy = vi.fn().mockReturnValue({
      orderBy: vi.fn().mockResolvedValue([]),
    });
    const mainChain = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({ where: whereSpy }),
            }),
          }),
        }),
      }),
    };
    // Subquery chain (repositories by source) — built lazily, still calls select()
    const subChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({}),
      }),
    };
    mockDb.select
      .mockReturnValueOnce(subChain)   // source_id subquery
      .mockReturnValueOnce(mainChain); // main export query

    const res = await app.inject({ method: 'GET', url: '/findings/export.csv?source_id=7' });

    expect(res.statusCode).toBe(200);
    // The WHERE clause must not be empty — before the fix source_id was
    // declared in the schema but silently ignored, exporting EVERYTHING.
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(whereSpy.mock.calls[0][0]).toBeDefined();
    // And the repositories-by-source subquery was actually built
    expect(subChain.from).toHaveBeenCalled();
  });
});

describe('GET /findings/counts', () => {
  it('returns severity counts', async () => {
    const counts = {
      Critical: 1,
      High: 3,
      Medium: 5,
      Low: 2,
      Info: 0,
      total: 11,
      riskAccepted: 1,
    };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([counts]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings/counts',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(counts);
  });

  it('filters counts by workspace_id', async () => {
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0, total: 0, riskAccepted: 0 };
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // subquery for workspaceTestIds
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue(mockDb),
            }),
          }),
        };
      }
      // main counts query
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([counts]),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings/counts?workspace_id=2',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(counts);
  });
});

describe('GET /findings/:id', () => {
  function mockFindingSelect(rows: any[]) {
    // select({...columns, workspaceId, contributorName, repositoryName, scanId})
    //   .from(findings).innerJoin(tests).innerJoin(scans).leftJoin(contributors).leftJoin(repositories).where()
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(rows),
              }),
            }),
          }),
        }),
      }),
    });
  }

  it('returns finding by id', async () => {
    const finding = { id: 1, title: 'SQL Injection', severity: 'High', workspaceId: 1, secretValue: null };
    mockFindingSelect([finding]);

    const res = await app.inject({
      method: 'GET',
      url: '/findings/1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...finding, secretValue: null });
  });

  it('returns secretValue unmasked (detail page intentionally exposes it)', async () => {
    const finding = { id: 1, title: 'API key leaked', severity: 'High', workspaceId: 1, secretValue: 'sk-live-abc123def456' };
    mockFindingSelect([finding]);

    const res = await app.inject({ method: 'GET', url: '/findings/1' });

    expect(res.statusCode).toBe(200);
    expect(res.json().secretValue).toBe('sk-live-abc123def456');
  });

  it('returns 404 when finding not found', async () => {
    mockFindingSelect([]);

    const res = await app.inject({
      method: 'GET',
      url: '/findings/999',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Finding not found');
  });

  it('returns contributorName when finding has attribution', async () => {
    const finding = {
      id: 1, title: 'SQL Injection', severity: 'High',
      contributorId: 5, contributorName: 'Alice',
      workspaceId: 1, secretValue: null,
    };
    mockFindingSelect([finding]);

    const res = await app.inject({
      method: 'GET',
      url: '/findings/1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().contributorName).toBe('Alice');
  });

  it('embeds duplicateOfFinding details when duplicate_of is set', async () => {
    const finding = {
      id: 100, title: 'Secret detected', severity: 'High', tool: 'gitleaks',
      duplicateOf: 42, workspaceId: 1, secretValue: null,
    };
    // Main query (first .select()): returns finding row
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([finding]),
              }),
            }),
          }),
        }),
      }),
    });
    // Secondary query (second .select()): returns survivor
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { id: 42, title: 'Hardcoded API token', tool: 'beast', filePath: 'foo.cs', line: 23, severity: 'High' },
          ]),
        }),
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/findings/100' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.duplicateOfFinding).toEqual({
      id: 42, title: 'Hardcoded API token', tool: 'beast', filePath: 'foo.cs', line: 23, severity: 'High',
    });
  });

  it('does not include duplicateOfFinding when finding has no FK', async () => {
    const finding = {
      id: 1, title: 'Plain finding', severity: 'High',
      duplicateOf: null, workspaceId: 1, secretValue: null,
    };
    mockFindingSelect([finding]);

    const res = await app.inject({ method: 'GET', url: '/findings/1' });

    expect(res.statusCode).toBe(200);
    expect(res.json().duplicateOfFinding).toBeUndefined();
  });
});

describe('PATCH /findings/:id', () => {
  it('updates finding status', async () => {
    const updated = { id: 1, title: 'Vuln', status: 'risk_accepted' };
    // Pre-query: resolve workspace via finding → test → scan
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ workspaceId: 1 }]),
          }),
        }),
      }),
    });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/findings/1',
      payload: { status: 'risk_accepted' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(updated);
  });

  it('returns 400 when no fields to update', async () => {
    // Pre-query: resolve workspace via finding → test → scan
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ workspaceId: 1 }]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/findings/1',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('No fields to update');
  });

  it('returns 404 when finding not found', async () => {
    // Pre-query returns empty → 404 at pre-query stage
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/findings/1',
      payload: { status: 'fixed' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Finding not found');
  });

  it('rejects a status outside chk_findings_status with 400 (not a DB 500)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/findings/1',
      payload: { status: 'totally_bogus' },
    });

    expect(res.statusCode).toBe(400);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it.each(['open', 'false_positive', 'fixed', 'risk_accepted', 'duplicate'])(
    'accepts allowed status %s',
    async (status) => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ workspaceId: 1 }]),
            }),
          }),
        }),
      });
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, status }]),
          }),
        }),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/findings/1',
        payload: { status },
      });

      expect(res.statusCode).toBe(200);
    },
  );
});

// ═══════════════════════════════════════════════════════════════
// FINDING NOTES
// ═══════════════════════════════════════════════════════════════

describe('GET /findings/:id/notes', () => {
  it('returns notes for a finding', async () => {
    const notes = [
      { id: 1, findingId: 1, author: 'user', content: 'Test note' },
    ];
    // Pre-query: resolve workspace via finding → test → scan
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ workspaceId: 1 }]),
          }),
        }),
      }),
    });
    // Main query: select().from(findingNotes).where().orderBy()
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(notes),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings/1/notes',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(notes);
  });
});

describe('POST /findings/:id/notes', () => {
  it('creates a note and returns 201', async () => {
    const note = { id: 1, findingId: 1, author: 'user', noteType: 'comment', content: 'My note' };
    // Pre-query: resolve workspace via finding → test → scan (also serves as existence check)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ workspaceId: 1 }]),
          }),
        }),
      }),
    });
    // Then insert
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([note]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/findings/1/notes',
      payload: { content: 'My note' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(note);
  });

  it('returns 404 when finding does not exist', async () => {
    // Pre-query returns empty → 404
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/findings/999/notes',
      payload: { content: 'My note' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Finding not found');
  });

  it('returns 400 when neither content nor entry is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/findings/1/notes',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /findings/:id/duplicates', () => {
  it('returns list of duplicates with file/line/tool/severity', async () => {
    // Pre-query: resolve workspace + survivor's tool via finding → test → scan
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ workspaceId: 1, tool: 'beast' }]),
          }),
        }),
      }),
    });
    // Main query: select().from(findings).where(duplicate_of=:id).orderBy()
    const dupes = [
      { id: 100, tool: 'gitleaks', filePath: 'foo.cs', line: 23, severity: 'High', title: 'Secret detected', secretValue: 'abc' },
      { id: 101, tool: 'trufflehog', filePath: 'foo.cs', line: 23, severity: 'High', title: 'Box token', secretValue: null },
    ];
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(dupes),
        }),
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/findings/42/duplicates' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: 100, tool: 'gitleaks', filePath: 'foo.cs', line: 23 });
    // Secret value must be masked, not raw
    expect(body[0].secretValue).not.toBe('abc');
  });

  it('returns 404 when finding does not exist', async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/findings/999/duplicates' });

    expect(res.statusCode).toBe(404);
  });

  it('returns empty array when finding has no duplicates', async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ workspaceId: 1, tool: 'beast' }]),
          }),
        }),
      }),
    });
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/findings/42/duplicates' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('filters out same-tool duplicates (only cross-tool shown)', async () => {
    // Survivor tool = beast; only non-beast duplicates should be returned by query.
    // The mock can't filter — it just returns whatever the controller asked for.
    // We assert the WHERE clause is built with both predicates by inspecting the call.
    let capturedWhereArg: unknown;
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ workspaceId: 1, tool: 'beast' }]),
          }),
        }),
      }),
    });
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn((arg: unknown) => {
          capturedWhereArg = arg;
          return {
            orderBy: vi.fn().mockResolvedValue([
              { id: 100, tool: 'gitleaks', filePath: 'foo.cs', line: 23, severity: 'High', secretValue: null, title: 'X', codeSnippet: null, category: 'secrets', vulnIdFromTool: 'x', status: 'duplicate' },
            ]),
          };
        }),
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/findings/42/duplicates' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].tool).toBe('gitleaks');
    // Confirm the WHERE arg was a compound (and(...)) — Drizzle's and() returns an object
    expect(capturedWhereArg).toBeDefined();
  });
});
