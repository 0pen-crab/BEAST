const BASE_URL = process.env.BEAST_URL || 'http://localhost:8000';

export interface AuthContext {
  token: string;
  user: { id: number; username: string; role: string };
}

export async function api(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${BASE_URL}/api${path}`;
  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  // Only set Content-Type for non-FormData bodies
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  return fetch(url, { ...options, headers });
}

export async function authedApi(
  auth: AuthContext,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return api(path, {
    ...options,
    headers: {
      Authorization: `Token ${auth.token}`,
      ...(options.headers as Record<string, string>),
    },
  });
}

/** Register a unique test user. Username includes timestamp to avoid collisions. */
export async function registerTestUser(suffix?: string): Promise<AuthContext> {
  const username = `test_${suffix ?? Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'testpass123' }),
  });
  if (!res.ok) {
    // If register fails (e.g. user exists), try login
    const loginRes = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'testpass123' }),
    });
    if (!loginRes.ok) throw new Error(`Auth failed: ${loginRes.status} ${await loginRes.text()}`);
    return loginRes.json();
  }
  return res.json();
}

/** Create a workspace and return its id. */
export async function createTestWorkspace(auth: AuthContext, name?: string): Promise<number> {
  const wsName = name ?? `test_ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const res = await authedApi(auth, '/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name: wsName }),
  });
  if (!res.ok) throw new Error(`Create workspace failed: ${res.status} ${await res.text()}`);
  const ws = await res.json();
  return ws.id;
}

/** Delete a workspace (cleanup). */
export async function deleteWorkspace(auth: AuthContext, id: number): Promise<void> {
  await authedApi(auth, `/workspaces/${id}`, { method: 'DELETE' });
}

/** Create a team in a workspace and return the team object. */
export async function createTestTeam(
  auth: AuthContext,
  workspaceId: number,
  name?: string,
): Promise<{ id: number; name: string }> {
  const teamName = name ?? `test_team_${Date.now()}`;
  const res = await authedApi(auth, '/teams', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, name: teamName }),
  });
  if (!res.ok) throw new Error(`Create team failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Add a repo via URL and return the repo object. */
export async function addTestRepo(
  auth: AuthContext,
  workspaceId: number,
  url: string = 'https://github.com/test/test-repo',
): Promise<{ id: number; name: string }> {
  const res = await authedApi(auth, '/repos/add-url', {
    method: 'POST',
    body: JSON.stringify({ url, workspace_id: workspaceId }),
  });
  if (!res.ok) throw new Error(`Add repo failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Login with existing credentials (e.g. admin/admin1). */
export async function loginUser(username: string, password: string): Promise<AuthContext> {
  const res = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Enable workspace tools (free/open-source only). */
export async function enableFreeTools(auth: AuthContext, workspaceId: number): Promise<void> {
  const freeTools = [
    'gitleaks', 'trufflehog',
    'trivy-secrets', 'trivy-sca', 'trivy-iac',
    'semgrep', 'osv-scanner', 'checkov',
  ];
  const tools = freeTools.map(key => ({ tool_key: key, enabled: true }));
  const res = await authedApi(auth, `/workspaces/${workspaceId}/tools`, {
    method: 'PUT',
    body: JSON.stringify({ tools }),
  });
  if (!res.ok) throw new Error(`Enable tools failed: ${res.status} ${await res.text()}`);
}

/** Trigger a scan for a repository. */
export async function triggerScan(
  auth: AuthContext,
  repositoryId: number,
): Promise<{ id: string; status: string }> {
  const res = await authedApi(auth, '/scans', {
    method: 'POST',
    body: JSON.stringify({ repositoryId }),
  });
  if (!res.ok) throw new Error(`Trigger scan failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Poll scan until it reaches a terminal status (completed/failed). */
export async function waitForScan(
  auth: AuthContext,
  scanId: string,
  timeoutMs: number = 600_000,
  pollIntervalMs: number = 5_000,
): Promise<any> {
  const start = Date.now();
  let transientErrors = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await authedApi(auth, `/scans/${scanId}`);
      if (!res.ok) {
        // Tolerate transient 502/503 (nginx proxy loses backend momentarily)
        if ((res.status === 502 || res.status === 503) && transientErrors < 10) {
          transientErrors++;
          console.log(`[waitForScan] Transient ${res.status}, retrying (${transientErrors}/10)...`);
          await new Promise(r => setTimeout(r, pollIntervalMs));
          continue;
        }
        throw new Error(`Get scan failed: ${res.status}`);
      }
      transientErrors = 0;
      const scan = await res.json();
      if (scan.status === 'completed' || scan.status === 'failed') {
        return scan;
      }
    } catch (err: any) {
      // Network errors (ECONNREFUSED, etc.) — retry
      if (err.cause?.code === 'ECONNREFUSED' && transientErrors < 10) {
        transientErrors++;
        console.log(`[waitForScan] Connection refused, retrying (${transientErrors}/10)...`);
        await new Promise(r => setTimeout(r, pollIntervalMs));
        continue;
      }
      throw err;
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Scan ${scanId} did not finish within ${timeoutMs / 1000}s`);
}
