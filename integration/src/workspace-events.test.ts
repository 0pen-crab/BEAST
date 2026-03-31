import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('workspace-events', () => {
  let auth: AuthContext;
  let wsId: number;

  beforeAll(async () => {
    auth = await registerTestUser('ws_events');
    wsId = await createTestWorkspace(auth, `ws_events_${Date.now()}`);

    // Create some activity that generates workspace events
    await api('/repos/add-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/test/ws-event-repo', workspace_id: wsId }),
    });
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('lists workspace events', async () => {
    const res = await api(`/workspace-events?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);
  });

  it('supports pagination', async () => {
    const res = await api(`/workspace-events?workspace_id=${wsId}&limit=5&offset=0`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.results.length).toBeLessThanOrEqual(5);
  });

  it('rejects request without workspace_id', async () => {
    const res = await api('/workspace-events');
    expect(res.status).toBe(400);
  });
});
