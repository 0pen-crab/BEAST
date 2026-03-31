import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('contributors', () => {
  let auth: AuthContext;
  let wsId: number;
  let contributorId: number;

  beforeAll(async () => {
    auth = await registerTestUser('contribs');
    wsId = await createTestWorkspace(auth, `contribs_ws_${Date.now()}`);
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('ingests contributor data', async () => {
    const res = await api('/contributors/ingest', {
      method: 'POST',
      body: JSON.stringify({
        repo_name: 'test-repo',
        repo_url: 'https://github.com/test/test-repo',
        workspace_id: wsId,
        contributors: [{
          email: `dev_${Date.now()}@test.com`,
          name: 'Test Contributor',
          commits: 42,
          loc_added: 1000,
          loc_removed: 200,
        }],
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ingested).toBe(1);
    expect(Object.keys(data.contributor_ids).length).toBe(1);
    contributorId = Object.values(data.contributor_ids)[0] as number;
  });

  it('lists contributors by workspace_id', async () => {
    const res = await api(`/contributors?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('results');
    expect(data.count).toBeGreaterThan(0);
  });

  it('gets contributor by id', async () => {
    const res = await api(`/contributors/${contributorId}`);
    expect(res.ok).toBe(true);
    const dev = await res.json();
    expect(dev.id).toBe(contributorId);
    expect(dev.displayName).toBe('Test Contributor');
  });

  it('gets contributor activity', async () => {
    const res = await api(`/contributors/${contributorId}/activity`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('gets contributor repos', async () => {
    const res = await api(`/contributors/${contributorId}/repos`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].repoName).toBe('test-repo');
  });

  it('gets contributor assessments', async () => {
    const res = await api(`/contributors/${contributorId}/assessments`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('merges two contributors', async () => {
    // Ingest a second contributor
    const email2 = `dev2_${Date.now()}@test.com`;
    const ingestRes = await api('/contributors/ingest', {
      method: 'POST',
      body: JSON.stringify({
        repo_name: 'test-repo-2',
        workspace_id: wsId,
        contributors: [{
          email: email2,
          name: 'Contributor Two',
          commits: 10,
          loc_added: 100,
          loc_removed: 50,
        }],
      }),
    });
    const ingestData = await ingestRes.json();
    const contrib2Id = Object.values(ingestData.contributor_ids)[0] as number;

    const res = await api('/contributors/merge', {
      method: 'POST',
      body: JSON.stringify({ source_id: contrib2Id, target_id: contributorId }),
    });
    expect(res.ok).toBe(true);
    const merged = await res.json();
    expect(merged.id).toBe(contributorId);
    expect(merged.emails).toContain(email2);
  });

  it('returns 404 for nonexistent contributor', async () => {
    const res = await api('/contributors/999999');
    expect(res.status).toBe(404);
  });
});
