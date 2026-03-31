import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('findings', () => {
  let auth: AuthContext;
  let wsId: number;

  beforeAll(async () => {
    auth = await registerTestUser('findings');
    wsId = await createTestWorkspace(auth, `findings_ws_${Date.now()}`);
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('GET /findings returns paginated result', async () => {
    const res = await api(`/findings?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);
    expect(typeof data.count).toBe('number');
  });

  it('GET /findings supports pagination params', async () => {
    const res = await api(`/findings?workspace_id=${wsId}&limit=10&offset=0`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.results.length).toBeLessThanOrEqual(10);
  });

  it('GET /findings supports severity filter', async () => {
    const res = await api(`/findings?workspace_id=${wsId}&severity=Critical`);
    expect(res.ok).toBe(true);
  });

  it('GET /findings supports sort and direction', async () => {
    const res = await api(`/findings?workspace_id=${wsId}&sort=created_at&dir=asc`);
    expect(res.ok).toBe(true);
  });

  it('GET /findings/counts returns severity breakdown', async () => {
    const res = await api(`/findings/counts?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('Critical');
    expect(data).toHaveProperty('High');
    expect(data).toHaveProperty('Medium');
    expect(data).toHaveProperty('Low');
    expect(data).toHaveProperty('Info');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('riskAccepted');
  });

  it('GET /findings/counts-by-tool returns tool breakdown', async () => {
    const res = await api(`/findings/counts-by-tool?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns 404 for nonexistent finding', async () => {
    const res = await api('/findings/999999');
    expect(res.status).toBe(404);
  });
});
