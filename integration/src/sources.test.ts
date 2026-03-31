import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('sources', () => {
  let auth: AuthContext;
  let wsId: number;

  beforeAll(async () => {
    auth = await registerTestUser('sources');
    wsId = await createTestWorkspace(auth, `sources_ws_${Date.now()}`);
  });

  afterAll(async () => {
    await deleteWorkspace(auth, wsId);
  });

  it('creates a local source', async () => {
    const res = await api('/sources', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: wsId,
        provider: 'local',
        org_name: '/tmp/test-repos',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.source).toBeTruthy();
    expect(data.source.provider).toBe('local');
  });

  it('lists sources by workspace_id', async () => {
    const res = await api(`/sources?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('gets source by id', async () => {
    const listRes = await api(`/sources?workspace_id=${wsId}`);
    const sources = await listRes.json();
    const sourceId = sources[0].id;

    const res = await api(`/sources/${sourceId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.id).toBe(sourceId);
  });

  it('deletes a source', async () => {
    // Create a fresh source to delete
    const createRes = await api('/sources', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: wsId,
        provider: 'local',
        org_name: '/tmp/delete-me',
      }),
    });
    const { source } = await createRes.json();

    const res = await api(`/sources/${source.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  it('rejects sources list without workspace_id', async () => {
    const res = await api('/sources');
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent source', async () => {
    const res = await api('/sources/999999');
    expect(res.status).toBe(404);
  });
});
