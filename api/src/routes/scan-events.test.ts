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
  app.addHook('preHandler', async (request) => {
    request.user = { id: 1, username: 'test', role: 'super_admin', displayName: 'Test', mustChangePassword: false };
  });
  const mod = await import('./scan-events.ts');
  await app.register(mod.scanEventRoutes);
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

// ── Plugin Registration ──────────────────────────────────────

describe('scanEventRoutes plugin', () => {
  it('registers without error', () => {
    expect(app).toBeDefined();
  });
});

// ── GET /scan-events ─────────────────────────────────────────

describe('GET /scan-events', () => {
  it('returns paginated results with count', async () => {
    const events = [
      { id: 1, executionId: 'exec-1', level: 'info', source: 'scanner', message: 'Started' },
      { id: 2, executionId: 'exec-1', level: 'error', source: 'scanner', message: 'Failed' },
    ];
    // COUNT query chain: db.select({count}).from().where()
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: '2' }]),
      }),
    });
    // SELECT query chain: db.select().from().where().orderBy().limit().offset()
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue(events),
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/scan-events',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('count', 2);
    expect(body).toHaveProperty('results');
    expect(body.results).toHaveLength(2);
  });

  it('passes filter params and returns filtered results', async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: '0' }]),
      }),
    });
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/scan-events?level=error&workspace_id=3',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });

  it('rejects invalid limit value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/scan-events?limit=999',
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects negative offset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/scan-events?offset=-1',
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── POST /scan-events ────────────────────────────────────────

describe('POST /scan-events', () => {
  it('creates event and returns 201', async () => {
    const createdEvent = {
      id: 1,
      executionId: 'exec-1',
      level: 'info',
      source: 'orchestrator',
      message: 'Scan started',
      details: {},
    };
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([createdEvent]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/scan-events',
      payload: {
        execution_id: 'exec-1',
        level: 'info',
        source: 'orchestrator',
        message: 'Scan started',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(createdEvent);
  });

  it('passes details and optional fields to the INSERT', async () => {
    const createdEvent = { id: 2, executionId: 'exec-2' };
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([createdEvent]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/scan-events',
      payload: {
        execution_id: 'exec-2',
        level: 'warning',
        source: 'gitleaks',
        message: 'Secret found',
        details: { file: 'env.ts' },
        repo_name: 'beast',
        workspace_id: 1,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('rejects invalid level value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/scan-events',
      payload: {
        execution_id: 'exec-1',
        level: 'critical',
        source: 'orchestrator',
        message: 'Bad level',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/scan-events',
      payload: {
        execution_id: 'exec-1',
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── GET /scan-events/stats ───────────────────────────────────

describe('GET /scan-events/stats', () => {
  it('returns unresolved counts', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { unresolved: '5', unresolved_errors: '2', unresolved_warnings: '3', total: '10' },
        ]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/scan-events/stats',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      unresolved: 5,
      unresolved_errors: 2,
      unresolved_warnings: 3,
      total: 10,
    });
  });

  it('accepts workspace_id filter', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { unresolved: '1', unresolved_errors: '0', unresolved_warnings: '1', total: '3' },
        ]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/scan-events/stats?workspace_id=7',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().unresolved).toBe(1);
  });
});

// ── PATCH /scan-events/:id ───────────────────────────────────

describe('PATCH /scan-events/:id', () => {
  it('marks event as resolved', async () => {
    const resolvedEvent = { id: 1, resolved: true, resolvedAt: '2026-03-06T00:00:00Z' };

    // First call: db.select({ workspaceId }).from(scanEvents).where(...) — authorization lookup
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ workspaceId: 1 }]),
      }),
    });

    // Second call: db.update(scanEvents).set(...).where(...).returning()
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([resolvedEvent]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/scan-events/1',
      payload: { resolved: true, resolved_by: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(resolvedEvent);
  });

  it('returns 404 when event not found', async () => {
    // db.select({ workspaceId }).from(scanEvents).where(...) — returns empty (event not found)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/scan-events/999',
      payload: { resolved: true },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Event not found' });
  });
});
