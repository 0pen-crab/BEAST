import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// Mock auth middleware so route guards are no-ops in unit tests
vi.mock('../middleware/auth.ts', () => ({
  requireRole: () => async () => {},
}));

// Mock entities used by workspace-events routes
vi.mock('../orchestrator/entities.ts', () => ({
  listWorkspaceEvents: vi.fn(),
}));

import { workspaceEventRoutes } from './workspace-events.ts';
import { listWorkspaceEvents } from '../orchestrator/entities.ts';

const mockListWorkspaceEvents = listWorkspaceEvents as ReturnType<typeof vi.fn>;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(workspaceEventRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Plugin Registration ──────────────────────────────────────

describe('workspaceEventRoutes plugin', () => {
  it('registers without error', () => {
    expect(app).toBeDefined();
  });
});

// ── GET /workspace-events ────────────────────────────────────

describe('GET /workspace-events', () => {
  it('returns events for a workspace', async () => {
    const events = {
      count: 2,
      results: [
        { id: 1, workspace_id: 1, event_type: 'scan_started', created_at: '2026-03-01T00:00:00Z' },
        { id: 2, workspace_id: 1, event_type: 'scan_completed', created_at: '2026-03-02T00:00:00Z' },
      ],
    };
    mockListWorkspaceEvents.mockResolvedValueOnce(events);

    const res = await app.inject({
      method: 'GET',
      url: '/workspace-events?workspace_id=1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('count', 2);
    expect(body).toHaveProperty('results');
    expect(body.results).toHaveLength(2);
    expect(mockListWorkspaceEvents).toHaveBeenCalledWith(1, {
      limit: 50,
      offset: 0,
      eventType: undefined,
    });
  });

  it('returns 400 when workspace_id is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workspace-events',
    });

    expect(res.statusCode).toBe(400);
    expect(mockListWorkspaceEvents).not.toHaveBeenCalled();
  });

  it('passes pagination and event_type to entity function', async () => {
    mockListWorkspaceEvents.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/workspace-events?workspace_id=3&limit=10&offset=20&event_type=scan_started',
    });

    expect(mockListWorkspaceEvents).toHaveBeenCalledWith(3, {
      limit: 10,
      offset: 20,
      eventType: 'scan_started',
    });
  });

  it('caps limit at 200', async () => {
    mockListWorkspaceEvents.mockResolvedValueOnce({ count: 0, results: [] });

    await app.inject({
      method: 'GET',
      url: '/workspace-events?workspace_id=1&limit=500',
    });

    // Zod schema caps at max(200), so the request should fail validation
    // since limit: z.coerce.number().min(1).max(200)
  });

  it('rejects limit over 200 with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workspace-events?workspace_id=1&limit=500',
    });

    expect(res.statusCode).toBe(400);
  });
});
