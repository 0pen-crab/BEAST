import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../orchestrator/infra-check.ts', () => ({
  hasOpenInfraIssues: vi.fn(),
}));

import { hasOpenInfraIssues } from '../../orchestrator/infra-check.ts';
import { healthRoutes } from './index.ts';

const mockHasOpenInfraIssues = vi.mocked(hasOpenInfraIssues);

beforeEach(() => {
  mockHasOpenInfraIssues.mockReset();
});

async function buildApp() {
  const app = Fastify();
  await app.register(healthRoutes as any, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('GET /api/health', () => {
  it('returns 200 ok when no infra issues', async () => {
    mockHasOpenInfraIssues.mockResolvedValue({ degraded: false, issues: [] });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    await app.close();
  });

  it('returns 503 with issues when infra is degraded', async () => {
    mockHasOpenInfraIssues.mockResolvedValue({
      degraded: true,
      issues: [
        { message: 'Cannot reach security-tools: All configured authentication methods failed', source: 'infra-check' },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0].message).toContain('security-tools');
    await app.close();
  });

  it('returns 200 ok if the infra check itself errors (does not block health)', async () => {
    mockHasOpenInfraIssues.mockRejectedValue(new Error('DB query exploded'));

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    // If the infra-check query fails we still report ok — the API is up.
    // The error is logged for diagnosis but we don't want a transient DB
    // glitch here to mask "API is alive".
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    await app.close();
  });
});
