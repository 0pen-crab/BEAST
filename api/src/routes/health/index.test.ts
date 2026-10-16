import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('./checks.ts', () => ({
  checkAllSystems: vi.fn(),
}));

import { checkAllSystems } from './checks.ts';
import { healthRoutes } from './index.ts';

const mockCheckAllSystems = vi.mocked(checkAllSystems);

beforeEach(() => {
  mockCheckAllSystems.mockReset();
});

async function buildApp() {
  const app = Fastify();
  await app.register(healthRoutes as any, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('GET /api/health', () => {
  it('returns 200 ok when all systems are healthy', async () => {
    mockCheckAllSystems.mockResolvedValue({ status: 'ok', failures: [] });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(body.failures).toBeUndefined();
    await app.close();
  });

  it('returns 503 degraded with named failures when a subsystem is broken', async () => {
    mockCheckAllSystems.mockResolvedValue({
      status: 'degraded',
      failures: [
        { system: 'worker', message: 'Worker heartbeat is stale (last seen 2026-07-04T09:00:00.000Z) — the worker container appears to be down' },
        { system: 'security-tools', message: 'Cannot reach security-tools: All configured authentication methods failed' },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.failures).toHaveLength(2);
    expect(body.failures[0]).toEqual({ system: 'worker', message: expect.stringContaining('heartbeat is stale') });
    expect(body.failures[1]).toEqual({ system: 'security-tools', message: expect.stringContaining('security-tools') });
    await app.close();
  });

  it('returns 503 down when the database is unreachable', async () => {
    mockCheckAllSystems.mockResolvedValue({
      status: 'down',
      failures: [{ system: 'db', message: 'Database is unreachable: connect ECONNREFUSED' }],
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('down');
    expect(body.failures).toEqual([
      { system: 'db', message: expect.stringContaining('Database is unreachable') },
    ]);
    await app.close();
  });
});
