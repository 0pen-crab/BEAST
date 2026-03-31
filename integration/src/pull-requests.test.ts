import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, addTestRepo, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('pull-requests', () => {
  let auth: AuthContext;
  let wsId: number;
  let repoId: number;

  beforeAll(async () => {
    auth = await registerTestUser('prs');
    wsId = await createTestWorkspace(auth, `prs_ws_${Date.now()}`);
    const repo = await addTestRepo(auth, wsId, 'https://github.com/test/pr-repo');
    repoId = repo.id;
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('rejects pull-requests list without repository_id', async () => {
    const res = await api('/pull-requests');
    expect(res.status).toBe(400);
  });

  it('lists pull requests for a repository (may be empty)', async () => {
    const res = await api(`/pull-requests?repository_id=${repoId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns 404 for nonexistent pull request', async () => {
    const res = await api('/pull-requests/999999');
    expect(res.status).toBe(404);
  });
});
