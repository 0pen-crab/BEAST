import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('workspaces', () => {
  let auth: AuthContext;

  beforeAll(async () => {
    auth = await registerTestUser('ws');
  });

  it('creates a workspace', async () => {
    const name = `ws_create_${Date.now()}`;
    const res = await api('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
    const ws = await res.json();
    expect(ws.id).toBeGreaterThan(0);
    expect(ws.name).toBe(name);
    expect(ws.defaultLanguage).toBe('en');

    await deleteWorkspace(auth, ws.id);
  });

  it('lists workspaces', async () => {
    const wsId = await createTestWorkspace(auth, `ws_list_${Date.now()}`);

    const res = await api('/workspaces');
    expect(res.ok).toBe(true);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((w: any) => w.id === wsId)).toBe(true);

    await deleteWorkspace(auth, wsId);
  });

  it('updates a workspace', async () => {
    const wsId = await createTestWorkspace(auth, `ws_update_${Date.now()}`);

    const res = await api(`/workspaces/${wsId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: `ws_updated_${Date.now()}`, description: 'updated desc' }),
    });
    expect(res.ok).toBe(true);
    const ws = await res.json();
    expect(ws.description).toBe('updated desc');

    await deleteWorkspace(auth, wsId);
  });

  it('deletes a workspace', async () => {
    const wsId = await createTestWorkspace(auth, `ws_delete_${Date.now()}`);

    const res = await api(`/workspaces/${wsId}`, { method: 'DELETE' });
    expect(res.ok).toBe(true);

    // Verify it's gone
    const list = await api('/workspaces');
    const workspaces = await list.json();
    expect(workspaces.some((w: any) => w.id === wsId)).toBe(false);
  });

  it('rejects duplicate workspace name', async () => {
    const name = `ws_dup_${Date.now()}`;
    const wsId = await createTestWorkspace(auth, name);

    const res = await api('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(409);

    await deleteWorkspace(auth, wsId);
  });

  it('returns 404 for nonexistent workspace update', async () => {
    const res = await api('/workspaces/999999', {
      method: 'PUT',
      body: JSON.stringify({ name: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  describe('workspace isolation', () => {
    it('teams in workspace A are not visible in workspace B', async () => {
      const wsA = await createTestWorkspace(auth, `iso_a_${Date.now()}`);
      const wsB = await createTestWorkspace(auth, `iso_b_${Date.now()}`);

      // Create team in workspace A
      await api('/teams', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: wsA, name: `team_a_${Date.now()}` }),
      });

      // Create team in workspace B
      await api('/teams', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: wsB, name: `team_b_${Date.now()}` }),
      });

      // List teams for workspace A
      const teamsA = await api(`/teams?workspace_id=${wsA}`);
      const dataA = await teamsA.json();
      expect(dataA.every((t: any) => t.workspaceId === wsA)).toBe(true);

      // List teams for workspace B
      const teamsB = await api(`/teams?workspace_id=${wsB}`);
      const dataB = await teamsB.json();
      expect(dataB.every((t: any) => t.workspaceId === wsB)).toBe(true);

      // No overlap
      const idsA = new Set(dataA.map((t: any) => t.id));
      const idsB = new Set(dataB.map((t: any) => t.id));
      for (const id of idsA) {
        expect(idsB.has(id)).toBe(false);
      }

      await deleteWorkspace(auth, wsA);
      await deleteWorkspace(auth, wsB);
    });
  });
});
