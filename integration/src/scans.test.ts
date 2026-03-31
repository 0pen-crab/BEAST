import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, registerTestUser, createTestWorkspace, deleteWorkspace, type AuthContext } from './helpers.ts';

describe('scans', () => {
  let auth: AuthContext;
  let wsId: number;

  beforeAll(async () => {
    auth = await registerTestUser('scans');
    wsId = await createTestWorkspace(auth, `scans_ws_${Date.now()}`);
  });

  afterAll(async () => {
    // Cancel all scans before deleting workspace
    await api('/scans/cancel-all', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: wsId }),
    });
    await deleteWorkspace(auth, wsId);
  });

  it('creates a scan with repoUrl', async () => {
    const res = await api('/scans', {
      method: 'POST',
      body: JSON.stringify({ repoUrl: 'https://github.com/test/scan-repo', workspaceId: wsId }),
    });
    expect(res.status).toBe(201);
    const scan = await res.json();
    expect(scan.id).toBeTruthy();
    expect(scan.status).toBe('queued');
  });

  it('lists scans by workspace_id', async () => {
    const res = await api(`/scans?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);
  });

  it('gets scan stats', async () => {
    const res = await api(`/scans/stats?workspace_id=${wsId}`);
    expect(res.ok).toBe(true);
    const stats = await res.json();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('queued');
    expect(stats).toHaveProperty('running');
    expect(stats).toHaveProperty('completed');
    expect(stats).toHaveProperty('failed');
  });

  it('gets scan by id', async () => {
    const createRes = await api('/scans', {
      method: 'POST',
      body: JSON.stringify({ repoUrl: 'https://github.com/test/scan-get', workspaceId: wsId }),
    });
    const scan = await createRes.json();

    const res = await api(`/scans/${scan.id}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.id).toBe(scan.id);
  });

  it('deletes a queued scan', async () => {
    const createRes = await api('/scans', {
      method: 'POST',
      body: JSON.stringify({ repoUrl: 'https://github.com/test/scan-del', workspaceId: wsId }),
    });
    const scan = await createRes.json();

    const res = await api(`/scans/${scan.id}`, { method: 'DELETE' });
    expect(res.ok).toBe(true);
  });

  it('cancel-all scans returns success', async () => {
    const res = await api('/scans/cancel-all', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: wsId }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('cancelled');
  });

  it('rejects scan without repoUrl or localPath', async () => {
    const res = await api('/scans', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: wsId }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent scan', async () => {
    const res = await api('/scans/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
