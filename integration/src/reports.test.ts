import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, addTestRepo, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('reports', () => {
  let auth: AuthContext;
  let wsId: number;
  let repoId: number;

  beforeAll(async () => {
    auth = await registerTestUser('reports');
    wsId = await createTestWorkspace(auth, `reports_ws_${Date.now()}`);
    const repo = await addTestRepo(auth, wsId, 'https://github.com/test/report-repo');
    repoId = repo.id;
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('GET /scan-reports/:scanId returns empty for nonexistent scan', async () => {
    const res = await api('/scan-reports/00000000-0000-0000-0000-000000000000');
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  it('GET /scan-reports/:scanId/:type rejects invalid type', async () => {
    const res = await api('/scan-reports/00000000-0000-0000-0000-000000000000/invalid');
    expect(res.status).toBe(400);
  });

  it('GET /scan-artifacts/:repositoryId returns artifacts array', async () => {
    const res = await api(`/scan-artifacts/${repoId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('artifacts');
    expect(Array.isArray(data.artifacts)).toBe(true);
  });
});
