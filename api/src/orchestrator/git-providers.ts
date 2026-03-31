import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

// ── Common types ─────────────────────────────────────────────

export interface DiscoveredRepo {
  externalId: string;
  name: string;
  url: string;
  description: string | null;
  defaultBranch: string | null;
  sizeBytes?: number | null;
  primaryLanguage?: string | null;
  lastActivityAt?: string | null;
}

export type OrgType = 'user' | 'organization' | 'group' | 'workspace';

// ── URL helpers ──────────────────────────────────────────────

/**
 * Strip embedded username from HTTPS git URLs (e.g. Bitbucket includes "user@" in clone links).
 * Returns a clean URL suitable for storage. Auth is injected separately at clone time.
 */
export function stripEmbeddedUsername(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
  } catch { /* not a URL, return as-is */ }
  return url;
}

/**
 * Build an authenticated clone URL by injecting credentials.
 * Each provider has its own auth strategy:
 *   - bitbucket: https://x-bitbucket-api-token-auth:token@bitbucket.org/org/repo.git
 *   - github:    https://x-access-token:token@github.com/org/repo.git
 *   - gitlab:    https://oauth2:token@gitlab.com/org/repo.git
 *   - local:     returns url unchanged (no auth needed)
 *
 * Note: For Bitbucket API tokens, git clone uses `x-bitbucket-api-token-auth`
 * as the username — the email is only used for REST API Basic auth headers,
 * not for git clone URLs.
 *
 * URL.username/password setters already percent-encode values, so we must NOT
 * call encodeURIComponent ourselves (that would cause double-encoding).
 *
 * Returns the original URL if provider is unknown or no token provided.
 */
export function buildAuthCloneUrl(
  provider: string,
  repoUrl: string,
  token?: string,
  _email?: string,
): string {
  if (!token || !repoUrl.startsWith('http')) return repoUrl;

  try {
    const parsed = new URL(repoUrl);

    switch (provider) {
      case 'bitbucket':
        parsed.username = 'x-bitbucket-api-token-auth';
        parsed.password = token;
        break;
      case 'github':
        parsed.username = 'x-access-token';
        parsed.password = token;
        break;
      case 'gitlab':
        parsed.username = 'oauth2';
        parsed.password = token;
        break;
      default:
        return repoUrl;
    }

    return parsed.toString();
  } catch {
    return repoUrl;
  }
}

// ── URL parser ───────────────────────────────────────────────

export function parseGitUrl(raw: string): { provider: string; orgName: string; repoSlug?: string; baseUrl: string } | null {
  let url = raw.trim().replace(/\/+$/, '');
  if (!url.startsWith('http')) url = `https://${url}`;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const orgName = pathParts[0];
  if (!orgName) return null;

  let repoSlug: string | undefined;
  if (pathParts.length >= 2) {
    repoSlug = pathParts[1].replace(/\.git$/, '');
  }

  const base = { provider: '', orgName, ...(repoSlug ? { repoSlug } : {}), baseUrl: '' };

  if (host === 'github.com') {
    return { ...base, provider: 'github', baseUrl: 'https://api.github.com' };
  }
  if (host === 'gitlab.com') {
    return { ...base, provider: 'gitlab', baseUrl: 'https://gitlab.com' };
  }
  if (host === 'bitbucket.org') {
    return { ...base, provider: 'bitbucket', baseUrl: 'https://api.bitbucket.org/2.0' };
  }

  return null;
}

// ── GitHub ────────────────────────────────────────────────────

export class GitHubClient {
  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async detectOrgType(name: string): Promise<OrgType> {
    const res = await fetch(`${this.baseUrl}/users/${encodeURIComponent(name)}`, { headers: this.headers() });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        throw new Error('RATE_LIMITED');
      }
      throw new Error(`GitHub API error: ${res.status}`);
    }
    const data = await res.json();
    return data.type === 'Organization' ? 'organization' : 'user';
  }

  async listRepos(name: string, orgType: OrgType, token?: string): Promise<DiscoveredRepo[]> {
    const headers = { ...this.headers() };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const repos: DiscoveredRepo[] = [];
    const endpoint = orgType === 'organization'
      ? `${this.baseUrl}/orgs/${encodeURIComponent(name)}/repos`
      : `${this.baseUrl}/users/${encodeURIComponent(name)}/repos`;

    let page = 1;
    while (true) {
      const res = await fetch(`${endpoint}?per_page=100&page=${page}`, { headers });
      if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
          throw new Error('RATE_LIMITED');
        }
        throw new Error(`GitHub API error: ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;

      for (const r of data) {
        repos.push({
          externalId: String(r.id),
          name: r.name,
          url: r.html_url ?? r.clone_url,
          description: r.description ?? null,
          defaultBranch: r.default_branch ?? null,
          sizeBytes: typeof r.size === 'number' ? r.size * 1024 : null,
          primaryLanguage: r.language ?? null,
          lastActivityAt: r.pushed_at ?? null,
        });
      }

      if (data.length < 100) break;
      page++;
    }

    return repos;
  }

  async getRepo(owner: string, repoSlug: string, token?: string): Promise<DiscoveredRepo> {
    const headers = { ...this.headers() };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}/repos/${owner}/${repoSlug}`, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const r = await res.json();

    return {
      externalId: String(r.id),
      name: r.name,
      url: r.html_url ?? r.clone_url,
      description: r.description ?? null,
      defaultBranch: r.default_branch ?? null,
      sizeBytes: typeof r.size === 'number' ? r.size * 1024 : null,
      primaryLanguage: r.language ?? null,
      lastActivityAt: r.pushed_at ?? null,
    };
  }
}

// ── GitLab ────────────────────────────────────────────────────

export class GitLabClient {
  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.token) h['PRIVATE-TOKEN'] = this.token;
    return h;
  }

  async detectOrgType(name: string): Promise<OrgType> {
    const groupRes = await fetch(`${this.baseUrl}/api/v4/groups/${encodeURIComponent(name)}`, { headers: this.headers() });
    if (groupRes.ok) return 'group';

    const userRes = await fetch(`${this.baseUrl}/api/v4/users?username=${encodeURIComponent(name)}`, { headers: this.headers() });
    if (userRes.ok) {
      const users = await userRes.json();
      if (Array.isArray(users) && users.length > 0) return 'user';
    }

    throw new Error(`GitLab: could not find user or group "${name}"`);
  }

  async listRepos(name: string, orgType: OrgType, token?: string): Promise<DiscoveredRepo[]> {
    const headers = { ...this.headers() };
    if (token) headers['PRIVATE-TOKEN'] = token;

    const repos: DiscoveredRepo[] = [];

    if (orgType === 'group') {
      let page = 1;
      while (true) {
        const res = await fetch(
          `${this.baseUrl}/api/v4/groups/${encodeURIComponent(name)}/projects?include_subgroups=true&per_page=100&page=${page}&statistics=true`,
          { headers },
        );
        if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;

        for (const r of data) {
          repos.push({
            externalId: String(r.id),
            name: r.path,
            url: r.web_url,
            description: r.description ?? null,
            defaultBranch: r.default_branch ?? null,
            sizeBytes: r.statistics?.repository_size ?? null,
            primaryLanguage: null, // GitLab doesn't include language in list endpoint
            lastActivityAt: r.last_activity_at ?? null,
          });
        }

        if (data.length < 100) break;
        page++;
      }
    } else {
      const userRes = await fetch(`${this.baseUrl}/api/v4/users?username=${encodeURIComponent(name)}`, { headers });
      if (!userRes.ok) throw new Error(`GitLab API error: ${userRes.status}`);
      const users = await userRes.json();
      if (!users[0]) throw new Error(`GitLab user "${name}" not found`);
      const userId = users[0].id;

      let page = 1;
      while (true) {
        const res = await fetch(
          `${this.baseUrl}/api/v4/users/${userId}/projects?per_page=100&page=${page}&statistics=true`,
          { headers },
        );
        if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;

        for (const r of data) {
          repos.push({
            externalId: String(r.id),
            name: r.path,
            url: r.web_url,
            description: r.description ?? null,
            defaultBranch: r.default_branch ?? null,
            sizeBytes: r.statistics?.repository_size ?? null,
            primaryLanguage: null, // GitLab doesn't include language in list endpoint
            lastActivityAt: r.last_activity_at ?? null,
          });
        }

        if (data.length < 100) break;
        page++;
      }
    }

    return repos;
  }

  async getRepo(namespace: string, repoSlug: string, token?: string): Promise<DiscoveredRepo> {
    const headers = { ...this.headers() };
    if (token) headers['PRIVATE-TOKEN'] = token;

    const projectPath = encodeURIComponent(`${namespace}/${repoSlug}`);
    const res = await fetch(`${this.baseUrl}/api/v4/projects/${projectPath}?statistics=true`, { headers });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);
    const r = await res.json();

    return {
      externalId: String(r.id),
      name: r.path,
      url: r.web_url,
      description: r.description ?? null,
      defaultBranch: r.default_branch ?? null,
      sizeBytes: r.statistics?.repository_size ?? null,
      primaryLanguage: null, // GitLab doesn't include language in project endpoint
      lastActivityAt: r.last_activity_at ?? null,
    };
  }
}

// ── BitBucket ─────────────────────────────────────────────────

export class BitBucketClient {
  constructor(
    private baseUrl: string,
    private token?: string,
    private email?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.token) {
      if (this.email) {
        // Bitbucket API tokens use HTTP Basic Auth with email:token
        h['Authorization'] = `Basic ${Buffer.from(`${this.email}:${this.token}`).toString('base64')}`;
      } else {
        h['Authorization'] = `Bearer ${this.token}`;
      }
    }
    return h;
  }

  async detectOrgType(_name: string): Promise<OrgType> {
    return 'workspace';
  }

  async listRepos(name: string, _orgType: OrgType, token?: string): Promise<DiscoveredRepo[]> {
    const headers = { ...this.headers() };
    if (token && !this.email) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const repos: DiscoveredRepo[] = [];
    let url: string | null = `${this.baseUrl}/repositories/${encodeURIComponent(name)}?pagelen=100`;

    while (url) {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`BitBucket API error: ${res.status}`);
      const data: any = await res.json();

      for (const r of data.values ?? []) {
        const rawCloneLink = r.links?.clone?.find((l: { name: string; href: string }) => l.name === 'https')?.href ?? r.links?.html?.href;
        // Strip embedded username from Bitbucket clone URLs (e.g. "user@bitbucket.org")
        const cloneLink = rawCloneLink ? stripEmbeddedUsername(rawCloneLink) : null;
        repos.push({
          externalId: r.uuid ?? String(r.slug),
          name: r.slug,
          url: cloneLink ?? `https://bitbucket.org/${name}/${r.slug}`,
          description: r.description ?? null,
          defaultBranch: r.mainbranch?.name ?? null,
          sizeBytes: typeof r.size === 'number' ? r.size : null,
          primaryLanguage: r.language || null,
          lastActivityAt: r.updated_on ?? null,
        });
      }

      url = data.next ?? null;
    }

    return repos;
  }

  async getRepo(workspace: string, repoSlug: string, token?: string): Promise<DiscoveredRepo> {
    const headers = { ...this.headers() };
    if (token && !this.email) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${this.baseUrl}/repositories/${workspace}/${repoSlug}`, { headers });
    if (!res.ok) throw new Error(`BitBucket API error: ${res.status}`);
    const r: any = await res.json();

    const rawCloneLink = r.links?.clone?.find((l: { name: string; href: string }) => l.name === 'https')?.href ?? r.links?.html?.href;
    const cloneLink = rawCloneLink ? stripEmbeddedUsername(rawCloneLink) : null;

    return {
      externalId: r.uuid ?? String(r.slug),
      name: r.slug,
      url: cloneLink ?? `https://bitbucket.org/${workspace}/${r.slug}`,
      description: r.description ?? null,
      defaultBranch: r.mainbranch?.name ?? null,
      sizeBytes: typeof r.size === 'number' ? r.size : null,
      primaryLanguage: r.language || null,
      lastActivityAt: r.updated_on ?? null,
    };
  }

  async validateToken(workspaceSlug: string): Promise<{ valid: boolean; username: string | null }> {
    try {
      const res = await fetch(
        `${this.baseUrl}/repositories/${encodeURIComponent(workspaceSlug)}?pagelen=1`,
        { headers: this.headers() },
      );
      if (!res.ok) return { valid: false, username: null };
      return { valid: true, username: this.email ?? null };
    } catch {
      return { valid: false, username: null };
    }
  }

  async detectScopes(workspaceSlug?: string): Promise<string[]> {
    // Use /repositories endpoint since it only needs repository:read scope
    const url = workspaceSlug
      ? `${this.baseUrl}/repositories/${encodeURIComponent(workspaceSlug)}?pagelen=1`
      : `${this.baseUrl}/user`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) return [];
    const scopeHeader = res.headers.get('x-oauth-scopes') ?? '';
    return scopeHeader.split(',').map(s => s.trim()).filter(Boolean);
  }

  async registerWorkspaceWebhook(
    workspaceSlug: string,
    webhookSecret: string,
    callbackUrl: string,
  ): Promise<{ id: string }> {
    const res = await fetch(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceSlug)}/hooks`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'BEAST Security Scanner',
          url: callbackUrl,
          active: true,
          secret: webhookSecret,
          events: ['pullrequest:created', 'pullrequest:updated'],
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to register webhook: ${res.status} ${err}`);
    }
    const data = await res.json();
    return { id: data.uuid };
  }

  async deleteWorkspaceWebhook(workspaceSlug: string, webhookId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceSlug)}/hooks/${encodeURIComponent(webhookId)}`,
      { method: 'DELETE', headers: this.headers() },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete webhook: ${res.status}`);
    }
  }

  async getPullRequestDiff(workspaceSlug: string, repoSlug: string, prId: number): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/repositories/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}/diff`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Failed to fetch PR diff: ${res.status}`);
    return res.text();
  }

  async postPullRequestComment(workspaceSlug: string, repoSlug: string, prId: number, content: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/repositories/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}/comments`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { raw: content } }),
      },
    );
    if (!res.ok) throw new Error(`Failed to post PR comment: ${res.status}`);
  }
}

// ── Local directory ───────────────────────────────────────────

export class LocalDirectoryClient {
  async listRepos(dirPath: string): Promise<DiscoveredRepo[]> {
    if (!existsSync(dirPath)) throw new Error(`Directory not found: ${dirPath}`);

    const entries = readdirSync(dirPath, { withFileTypes: true });
    const repos: DiscoveredRepo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(dirPath, entry.name);
      if (existsSync(join(fullPath, '.git'))) {
        repos.push({
          externalId: entry.name,
          name: entry.name,
          url: fullPath,
          description: null,
          defaultBranch: null,
        });
      }
    }

    return repos;
  }
}

// ── Factory ──────────────────────────────────────────────────

export function createClient(provider: string, baseUrl: string, token?: string, email?: string) {
  switch (provider) {
    case 'github': return new GitHubClient(baseUrl, token);
    case 'gitlab': return new GitLabClient(baseUrl, token);
    case 'bitbucket': return new BitBucketClient(baseUrl, token, email);
    case 'local': return new LocalDirectoryClient();
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
