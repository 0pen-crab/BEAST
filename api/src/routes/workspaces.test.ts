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

vi.mock('../orchestrator/entities.ts', () => ({
  initDefaultTools: vi.fn().mockResolvedValue(undefined),
}));

import { initDefaultTools } from '../orchestrator/entities.ts';

import { db } from '../db/index.ts';

const mockDb = db as any;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Simulate authenticated super_admin user for GET /workspaces which reads request.user
  app.addHook('onRequest', async (request) => {
    request.user = { id: 1, username: 'admin', role: 'super_admin', displayName: 'Admin', mustChangePassword: false };
  });
  const mod = await import('./workspaces.ts');
  await app.register(mod.workspaceRoutes);
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
  vi.mocked(initDefaultTools).mockReset().mockResolvedValue(undefined);
});

// ── GET /workspaces ──────────────────────────────────────────

describe('GET /workspaces', () => {
  it('returns 200 with list of workspaces', async () => {
    const workspaces = [
      { id: 1, name: 'Workspace 1', description: null, createdAt: '2026-01-01' },
      { id: 2, name: 'Workspace 2', description: 'desc', createdAt: '2026-01-02' },
    ];
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(workspaces),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(workspaces);
  });

  it('returns 200 with empty array when no workspaces', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ── POST /workspaces ─────────────────────────────────────────

describe('POST /workspaces', () => {
  it('returns 201 with created workspace', async () => {
    const created = { id: 1, name: 'New WS', description: null, defaultLanguage: 'en' };
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([created]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'New WS' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(created);
    expect(initDefaultTools).toHaveBeenCalledWith(expect.any(Number));
  });

  it('returns 409 for duplicate workspace name (direct code)', async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue({ code: '23505' }),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'Existing' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already exists');
  });

  it('returns 409 for duplicate workspace name (Drizzle-wrapped error)', async () => {
    const drizzleError = new Error('Failed query');
    (drizzleError as any).cause = { code: '23505' };
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue(drizzleError),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'Existing' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already exists');
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when name is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('accepts scan_depth on creation', async () => {
    const created = { id: 5, name: 'Deep WS', scanDepth: 100 };
    const mockValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([created]),
    });
    mockDb.insert.mockReturnValue({ values: mockValues });

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'Deep WS', scan_depth: 100 },
    });

    expect(res.statusCode).toBe(201);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ scanDepth: 100 }));
  });

  it('defaults scan_depth to 500 when not provided', async () => {
    const created = { id: 6, name: 'Default WS', scanDepth: 500 };
    const mockValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([created]),
    });
    mockDb.insert.mockReturnValue({ values: mockValues });

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'Default WS' },
    });

    expect(res.statusCode).toBe(201);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ scanDepth: 500 }));
  });

  it('rejects scan_depth with invalid value on creation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'Bad WS', scan_depth: 999 },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── PUT /workspaces/:id ──────────────────────────────────────

describe('PUT /workspaces/:id', () => {
  it('returns 200 with updated workspace', async () => {
    const updated = { id: 1, name: 'Updated', description: 'new desc' };
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1',
      payload: { name: 'Updated', description: 'new desc' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(updated);
  });

  it('returns 404 when workspace not found', async () => {
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/999',
      payload: { name: 'Test' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not found');
  });

  it('accepts ai_model_* fields with valid values', async () => {
    const updated = { id: 1, name: 'WS', aiModelAnalyzer: 'haiku', aiModelScanner: 'sonnet', aiModelTriage: 'opus' };
    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([updated]),
      }),
    });
    mockDb.update.mockReturnValue({ set: mockSet });

    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1',
      payload: {
        ai_model_analyzer: 'haiku',
        ai_model_scanner: 'sonnet',
        ai_model_triage: 'opus',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        aiModelAnalyzer: 'haiku',
        aiModelScanner: 'sonnet',
        aiModelTriage: 'opus',
      }),
    );
  });

  it('rejects invalid ai_model value', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1',
      payload: { ai_model_analyzer: 'gpt-4' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('accepts scan_depth with valid value (1500)', async () => {
    const updated = { id: 1, name: 'WS', scanDepth: 1500 };
    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([updated]),
      }),
    });
    mockDb.update.mockReturnValue({ set: mockSet });

    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1',
      payload: { scan_depth: 1500 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ scanDepth: 1500 }));
  });

  it('accepts scan_depth with valid value (500)', async () => {
    const updated = { id: 1, name: 'WS', scanDepth: 500 };
    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([updated]),
      }),
    });
    mockDb.update.mockReturnValue({ set: mockSet });

    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1',
      payload: { scan_depth: 500 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ scanDepth: 500 }));
  });

  it('accepts scan_depth with valid value (100)', async () => {
    const updated = { id: 1, name: 'WS', scanDepth: 100 };
    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([updated]),
      }),
    });
    mockDb.update.mockReturnValue({ set: mockSet });

    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1',
      payload: { scan_depth: 100 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ scanDepth: 100 }));
  });

  it('rejects scan_depth with invalid value', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1',
      payload: { scan_depth: 250 },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── DELETE /workspaces/:id ───────────────────────────────────

describe('DELETE /workspaces/:id', () => {
  it('returns 200 with deleted: true', async () => {
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/workspaces/1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
  });

  it('returns 404 when workspace not found', async () => {
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/workspaces/999',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not found');
  });
});
