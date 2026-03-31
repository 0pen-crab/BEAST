import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requireWorkspaceId } from './workspace.ts';

function buildTestApp() {
  const app = Fastify();
  app.get('/test', { preHandler: requireWorkspaceId }, async (req) => {
    return { workspaceId: req.workspaceId };
  });
  app.post('/test', { preHandler: requireWorkspaceId }, async (req) => {
    return { workspaceId: req.workspaceId };
  });
  return app;
}

describe('requireWorkspaceId', () => {
  it('extracts workspace_id from querystring', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/test?workspace_id=5' });
    expect(res.statusCode).toBe(200);
    expect(res.json().workspaceId).toBe(5);
  });

  it('extracts workspace_id from body', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/test',
      payload: { workspace_id: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workspaceId).toBe(3);
  });

  it('extracts workspaceId (camelCase) from body', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/test',
      payload: { workspaceId: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workspaceId).toBe(7);
  });

  it('returns 400 when workspace_id is missing', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('workspace_id');
  });

  it('returns 400 when workspace_id is not a number', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/test?workspace_id=abc' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when workspace_id is zero', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/test?workspace_id=0' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when workspace_id is negative', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/test?workspace_id=-1' });
    expect(res.statusCode).toBe(400);
  });
});
