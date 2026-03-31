import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('scan-events', () => {
  let auth: AuthContext;
  let wsId: number;
  let eventId: number;

  beforeAll(async () => {
    auth = await registerTestUser('scan_events');
    wsId = await createTestWorkspace(auth, `scan_events_ws_${Date.now()}`);
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('creates a scan event', async () => {
    const res = await api('/scan-events', {
      method: 'POST',
      body: JSON.stringify({
        execution_id: `test_exec_${Date.now()}`,
        level: 'info',
        source: 'integration-test',
        message: 'Test scan event created',
        workspace_id: wsId,
      }),
    });
    expect(res.status).toBe(201);
    const event = await res.json();
    expect(event.id).toBeGreaterThan(0);
    expect(event.level).toBe('info');
    eventId = event.id;
  });

  it('lists scan events by workspace_id', async () => {
    const res = await api(`/scan-events?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('results');
    expect(data.count).toBeGreaterThan(0);
  });

  it('gets scan event stats', async () => {
    const res = await api(`/scan-events/stats?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const stats = await res.json();
    expect(stats).toHaveProperty('unresolved');
    expect(stats).toHaveProperty('total');
    expect(typeof stats.total).toBe('number');
  });

  it('resolves a scan event', async () => {
    const res = await api(`/scan-events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved: true, resolved_by: 'test-user' }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.resolved).toBe(true);
    expect(data.resolvedBy).toBe('test-user');
  });

  it('unresolves a scan event', async () => {
    const res = await api(`/scan-events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved: false }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.resolved).toBe(false);
  });

  it('rejects invalid level', async () => {
    const res = await api('/scan-events', {
      method: 'POST',
      body: JSON.stringify({
        execution_id: 'test',
        level: 'invalid_level',
        source: 'test',
        message: 'test',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent event', async () => {
    const res = await api('/scan-events/999999', {
      method: 'PATCH',
      body: JSON.stringify({ resolved: true }),
    });
    expect(res.status).toBe(404);
  });
});
