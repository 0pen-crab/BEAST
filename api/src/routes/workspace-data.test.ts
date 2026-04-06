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
  it('returns updated count when team_id provided', async () => {
    // Pre-query: resolve workspace from first repo via team join
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ wsId: 1 }]),
          }),
        }),
      }),
    });
    // update().set().where() — non-returning
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
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
      url: '/tests?scan_id=abc-123',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
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
  it('returns 200 with count and results', async () => {
    const findingsList = [
      { id: 1, title: 'SQL Injection', severity: 'High', status: 'open', secretValue: 'abc123secret' },
      { id: 2, title: 'XSS', severity: 'Medium', status: 'open', secretValue: null },
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
