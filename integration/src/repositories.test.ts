import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, createTestTeam, addTestRepo, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('repositories', () => {
  let auth: AuthContext;
  let wsId: number;

  beforeAll(async () => {
    auth = await registerTestUser('repos');
    wsId = await createTestWorkspace(auth, `repos_ws_${Date.now()}`);
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('adds a repo via URL', async () => {
    const res = await api('/repos/add-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/test/repo-add', workspace_id: wsId }),
    });
    expect(res.status).toBe(201);
    const repo = await res.json();
    expect(repo.name).toBe('repo-add');
    expect(repo.id).toBeGreaterThan(0);
  });

  it('lists repositories by workspace_id', async () => {
    await addTestRepo(auth, wsId, 'https://github.com/test/repo-list');

    const res = await api(`/repositories?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const repos = await res.json();
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.some((r: any) => r.name === 'repo-list')).toBe(true);
  });

  it('gets repository by id with teamName and findingsCount', async () => {
    const repo = await addTestRepo(auth, wsId, 'https://github.com/test/repo-get');

    const res = await api(`/repositories/${repo.id}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.id).toBe(repo.id);
    expect(data).toHaveProperty('teamName');
    expect(data).toHaveProperty('findingsCount');
  });

  it('updates a repository', async () => {
    const repo = await addTestRepo(auth, wsId, 'https://github.com/test/repo-upd');
    const newName = `repo_updated_${Date.now()}`;

    const res = await api(`/repositories/${repo.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.name).toBe(newName);
  });

  it('deletes a repository', async () => {
    const repo = await addTestRepo(auth, wsId, 'https://github.com/test/repo-del');

    const res = await api(`/repositories/${repo.id}`, { method: 'DELETE' });
    expect(res.ok).toBe(true);

    const getRes = await api(`/repositories/${repo.id}`);
    expect(getRes.status).toBe(404);
  });

  it('bulk updates repositories', async () => {
    const repo1 = await addTestRepo(auth, wsId, 'https://github.com/test/bulk-1');
    const repo2 = await addTestRepo(auth, wsId, 'https://github.com/test/bulk-2');

    const team = await createTestTeam(auth, wsId, `bulk_team_${Date.now()}`);

    const res = await api('/repositories/bulk', {
      method: 'PATCH',
      body: JSON.stringify({ ids: [repo1.id, repo2.id], team_id: team.id }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.updated).toBe(2);
  });

  it('rejects add-url without workspace_id', async () => {
    const res = await api('/repos/add-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://github.com/test/no-ws' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects add-url without url', async () => {
    const res = await api('/repos/add-url', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: wsId }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent repository', async () => {
    const res = await api('/repositories/999999');
    expect(res.status).toBe(404);
  });

  describe('workspace isolation', () => {
    it('repo in workspace A is not listed in workspace B', async () => {
      const wsB = await createTestWorkspace(auth, `iso_repos_b_${Date.now()}`);

      await addTestRepo(auth, wsId, 'https://github.com/test/iso-repo-a');

      const reposB = await api(`/repositories?workspace_id=${wsB}`);
      const dataB = await reposB.json();
      expect(dataB.every((r: any) => r.name !== 'iso-repo-a')).toBe(true);

      await deleteWorkspace(auth, wsB);
    });
  });
});
