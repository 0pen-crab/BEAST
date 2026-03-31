import { describe, it, expect } from 'vitest';
import { api, registerTestUser, createTestWorkspace, deleteWorkspace } from './helpers.ts';

describe('smoke', () => {
  it('health check responds', async () => {
    const res = await api('/health');
    expect(res.ok).toBe(true);
  });

  it('auth flow works (register + me)', async () => {
    const auth = await registerTestUser('smoke');
    expect(auth.token).toBeTruthy();
    expect(auth.user.username).toContain('test_smoke');

    const me = await api('/auth/me', {
      headers: { Authorization: `Token ${auth.token}` },
    });
    expect(me.ok).toBe(true);
    const meData = await me.json();
    expect(meData.username).toBe(auth.user.username);
  });

  it('workspace CRUD works', async () => {
    const auth = await registerTestUser('smoke_ws');
    const wsId = await createTestWorkspace(auth, `smoke_${Date.now()}`);
    expect(wsId).toBeGreaterThan(0);

    const teams = await api(`/teams?workspace_id=${wsId}`);
    expect(teams.ok).toBe(true);

    await deleteWorkspace(auth, wsId);
  });

  it('team creation works', async () => {
    const auth = await registerTestUser('smoke_team');
    const wsId = await createTestWorkspace(auth);

    const res = await api('/teams', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: wsId, name: `smoke_team_${Date.now()}` }),
    });
    expect(res.status).toBe(201);

    await deleteWorkspace(auth, wsId);
  });

  it('repo add-url works', async () => {
    const auth = await registerTestUser('smoke_repo');
    const wsId = await createTestWorkspace(auth);

    const res = await api('/repos/add-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/test/smoke-repo', workspace_id: wsId }),
    });
    expect(res.status).toBe(201);
    const repo = await res.json();
    expect(repo.name).toBe('smoke-repo');

    await deleteWorkspace(auth, wsId);
  });
});
