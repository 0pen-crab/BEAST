import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, createTestTeam, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('teams', () => {
  let auth: AuthContext;
  let wsId: number;

  beforeAll(async () => {
    auth = await registerTestUser('teams');
    wsId = await createTestWorkspace(auth, `teams_ws_${Date.now()}`);
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('creates a team', async () => {
    const res = await api('/teams', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: wsId, name: `team_create_${Date.now()}` }),
    });
    expect(res.status).toBe(201);
    const team = await res.json();
    expect(team.id).toBeGreaterThan(0);
    expect(team.workspaceId).toBe(wsId);
  });

  it('lists teams filtered by workspace_id', async () => {
    const teamName = `team_list_${Date.now()}`;
    await createTestTeam(auth, wsId, teamName);

    const res = await api(`/teams?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const teams = await res.json();
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.some((t: any) => t.name === teamName)).toBe(true);
    expect(teams.every((t: any) => t.workspaceId === wsId)).toBe(true);
  });

  it('gets team by id', async () => {
    const team = await createTestTeam(auth, wsId, `team_get_${Date.now()}`);

    const res = await api(`/teams/${team.id}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.id).toBe(team.id);
    expect(data.name).toBe(team.name);
  });

  it('updates a team', async () => {
    const team = await createTestTeam(auth, wsId, `team_upd_${Date.now()}`);
    const newName = `team_updated_${Date.now()}`;

    const res = await api(`/teams/${team.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.name).toBe(newName);
  });

  it('deletes a team', async () => {
    const team = await createTestTeam(auth, wsId, `team_del_${Date.now()}`);

    const res = await api(`/teams/${team.id}`, { method: 'DELETE' });
    expect(res.ok).toBe(true);

    const getRes = await api(`/teams/${team.id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for nonexistent team', async () => {
    const res = await api('/teams/999999');
    expect(res.status).toBe(404);
  });

  it('rejects team creation without workspace_id', async () => {
    const res = await api('/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'no_workspace' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects team creation with empty name', async () => {
    const res = await api('/teams', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: wsId, name: '' }),
    });
    expect(res.status).toBe(400);
  });
});
