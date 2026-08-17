import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('git-providers', () => {
  describe('parseGitUrl', () => {
    it('detects github.com org', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://github.com/facebook');
      expect(result).toEqual({ provider: 'github', orgName: 'facebook', baseUrl: 'https://api.github.com' });
    });

    it('detects gitlab.com group', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://gitlab.com/gnome');
      expect(result).toEqual({ provider: 'gitlab', orgName: 'gnome', baseUrl: 'https://gitlab.com' });
    });

    it('detects bitbucket.org workspace', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://bitbucket.org/atlassian');
      expect(result).toEqual({ provider: 'bitbucket', orgName: 'atlassian', baseUrl: 'https://api.bitbucket.org/2.0' });
    });

    it('handles URLs without scheme', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('github.com/facebook');
      expect(result).toEqual({ provider: 'github', orgName: 'facebook', baseUrl: 'https://api.github.com' });
    });

    it('handles trailing slashes', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://github.com/facebook/');
      expect(result).toEqual({ provider: 'github', orgName: 'facebook', baseUrl: 'https://api.github.com' });
    });

    it('returns null for unknown hosts', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://example.com/org');
      expect(result).toBeNull();
    });

    it('should extract repoSlug from GitHub repo URL', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://github.com/myorg/myrepo');
      expect(result).toEqual({
        provider: 'github',
        orgName: 'myorg',
        repoSlug: 'myrepo',
        baseUrl: 'https://api.github.com',
      });
    });

    it('should extract repoSlug from Bitbucket repo URL', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://bitbucket.org/myworkspace/myrepo');
      expect(result).toEqual({
        provider: 'bitbucket',
        orgName: 'myworkspace',
        repoSlug: 'myrepo',
        baseUrl: 'https://api.bitbucket.org/2.0',
      });
    });

    it('should extract repoSlug from GitLab repo URL', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://gitlab.com/mygroup/myrepo');
      expect(result).toEqual({
        provider: 'gitlab',
        orgName: 'mygroup',
        repoSlug: 'myrepo',
        baseUrl: 'https://gitlab.com',
      });
    });

    it('should strip .git suffix from repoSlug', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://github.com/myorg/myrepo.git');
      expect(result).toEqual({
        provider: 'github',
        orgName: 'myorg',
        repoSlug: 'myrepo',
        baseUrl: 'https://api.github.com',
      });
    });

    it('should return no repoSlug for org-only URLs', async () => {
      const { parseGitUrl } = await import('./git-providers.ts');
      const result = parseGitUrl('https://github.com/myorg');
      expect(result).toEqual({
        provider: 'github',
        orgName: 'myorg',
        baseUrl: 'https://api.github.com',
      });
      expect(result!.repoSlug).toBeUndefined();
    });
  });

  describe('GitHubClient', () => {
    it('detects user vs organization', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const client = new GitHubClient('https://api.github.com');

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: 'test-user', type: 'User' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.detectOrgType('test-user');
      expect(result).toBe('user');

      vi.unstubAllGlobals();
    });

    it('lists repos for a user', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const client = new GitHubClient('https://api.github.com');

      const mockRepos = [
        { id: 1, name: 'repo1', html_url: 'https://github.com/test-user/repo1', description: 'test', default_branch: 'main' },
        { id: 2, name: 'repo2', html_url: 'https://github.com/test-user/repo2', description: null, default_branch: 'master' },
      ];

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepos,
        headers: new Headers(),
      });
      vi.stubGlobal('fetch', mockFetch);

      const repos = await client.listRepos('test-user', 'user');
      expect(repos).toHaveLength(2);
      expect(repos[0]).toEqual({
        externalId: '1',
        name: 'repo1',
        url: 'https://github.com/test-user/repo1',
        description: 'test',
        defaultBranch: 'main',
        sizeBytes: null,
        primaryLanguage: null,
        lastActivityAt: null,
      });

      vi.unstubAllGlobals();
    });

    it('getRepo should fetch a single repo', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1, name: 'myrepo', html_url: 'https://github.com/myorg/myrepo',
          description: 'A repo', default_branch: 'main', size: 100,
          language: 'TypeScript', pushed_at: '2026-01-01T00:00:00Z',
        }),
      } as any);
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitHubClient('https://api.github.com');
      const repo = await client.getRepo('myorg', 'myrepo');
      expect(repo).toEqual({
        externalId: '1', name: 'myrepo', url: 'https://github.com/myorg/myrepo',
        description: 'A repo', defaultBranch: 'main', sizeBytes: 102400,
        primaryLanguage: 'TypeScript', lastActivityAt: '2026-01-01T00:00:00Z',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/myorg/myrepo',
        expect.objectContaining({ headers: expect.any(Object) }),
      );

      vi.unstubAllGlobals();
    });

    it('getRepo throws RATE_LIMITED on 403', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => '{"message":"API rate limit exceeded"}',
      } as any);
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitHubClient('https://api.github.com');
      await expect(client.getRepo('myorg', 'myrepo')).rejects.toThrow('RATE_LIMITED');

      vi.unstubAllGlobals();
    });

    it('getRepo throws RATE_LIMITED on 429', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => '',
      } as any);
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitHubClient('https://api.github.com');
      await expect(client.getRepo('myorg', 'myrepo')).rejects.toThrow('RATE_LIMITED');

      vi.unstubAllGlobals();
    });

    it('getRepo throws GitHub API error on 404', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"message":"Not Found"}',
      } as any);
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitHubClient('https://api.github.com');
      await expect(client.getRepo('myorg', 'missing')).rejects.toThrow(/404/);

      vi.unstubAllGlobals();
    });

    it('getRepo logs response body on error', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => '{"message":"You have exceeded a secondary rate limit"}',
      } as any);
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitHubClient('https://api.github.com');
      await expect(client.getRepo('myorg', 'myrepo')).rejects.toThrow();

      const logged = consoleSpy.mock.calls.flat().join(' ');
      expect(logged).toContain('secondary rate limit');
      expect(logged).toContain('myorg/myrepo');

      consoleSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('extracts size, language, and pushed_at metadata', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const client = new GitHubClient('https://api.github.com');

      const mockRepos = [
        {
          id: 1,
          name: 'repo1',
          html_url: 'https://github.com/org/repo1',
          description: 'test',
          default_branch: 'main',
          size: 75082,       // KB
          language: 'TypeScript',
          pushed_at: '2026-03-10T14:03:17Z',
        },
        {
          id: 2,
          name: 'repo2',
          html_url: 'https://github.com/org/repo2',
          description: null,
          default_branch: 'master',
          size: 0,
          language: null,
          pushed_at: null,
        },
      ];

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepos,
      });
      vi.stubGlobal('fetch', mockFetch);

      const repos = await client.listRepos('org', 'organization');

      expect(repos[0].sizeBytes).toBe(75082 * 1024);
      expect(repos[0].primaryLanguage).toBe('TypeScript');
      expect(repos[0].lastActivityAt).toBe('2026-03-10T14:03:17Z');

      expect(repos[1].sizeBytes).toBe(0);
      expect(repos[1].primaryLanguage).toBeNull();
      expect(repos[1].lastActivityAt).toBeNull();

      vi.unstubAllGlobals();
    });
  });

  describe('GitLabClient', () => {
    it('detects group', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      const client = new GitLabClient('https://gitlab.com');

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, path: 'gnome', name: 'GNOME' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.detectOrgType('gnome');
      expect(result).toBe('group');

      vi.unstubAllGlobals();
    });

    it('getRepo should fetch a single repo', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 42, path: 'myrepo', web_url: 'https://gitlab.com/mygroup/myrepo',
          description: 'A repo', default_branch: 'main',
          statistics: { repository_size: 80000 }, last_activity_at: '2026-03-01T00:00:00Z',
        }),
      } as any);
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient('https://gitlab.com');
      const repo = await client.getRepo('mygroup', 'myrepo');
      expect(repo).toEqual({
        externalId: '42', name: 'myrepo', url: 'https://gitlab.com/mygroup/myrepo',
        description: 'A repo', defaultBranch: 'main', sizeBytes: 80000,
        primaryLanguage: null, lastActivityAt: '2026-03-01T00:00:00Z',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/mygroup%2Fmyrepo?statistics=true',
        expect.objectContaining({ headers: expect.any(Object) }),
      );

      vi.unstubAllGlobals();
    });

    it('extracts size and last_activity_at metadata from group projects', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      const client = new GitLabClient('https://gitlab.com');

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          id: 42,
          path: 'my-project',
          web_url: 'https://gitlab.com/group/my-project',
          description: 'A project',
          default_branch: 'main',
          statistics: { repository_size: 5242880 },
          last_activity_at: '2026-02-20T08:00:00Z',
        }]),
      });
      vi.stubGlobal('fetch', mockFetch);

      const repos = await client.listRepos('group', 'group');

      expect(repos[0].sizeBytes).toBe(5242880);
      expect(repos[0].primaryLanguage).toBeNull(); // GitLab doesn't include language in list endpoint
      expect(repos[0].lastActivityAt).toBe('2026-02-20T08:00:00Z');

      vi.unstubAllGlobals();
    });

    it('listAccessibleRepos returns all projects the token has access to', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      const client = new GitLabClient('https://gitlab.example.com', 'glpat-xxx');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          // /api/v4/user — auth probe
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 42, username: 'me' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([
            { id: 1, path: 'r1', web_url: 'https://gitlab.example.com/g/r1', description: null, default_branch: 'main', statistics: { repository_size: 100 }, last_activity_at: '2026-01-01T00:00:00Z' },
            { id: 2, path: 'r2', web_url: 'https://gitlab.example.com/g/r2', description: 'x', default_branch: 'main', statistics: { repository_size: 200 }, last_activity_at: '2026-01-02T00:00:00Z' },
          ]),
        });
      vi.stubGlobal('fetch', mockFetch);

      const repos = await client.listAccessibleRepos();

      expect(repos).toHaveLength(2);
      expect(repos[0]).toEqual({
        externalId: '1', name: 'r1', url: 'https://gitlab.example.com/g/r1',
        description: null, defaultBranch: 'main', sizeBytes: 100,
        primaryLanguage: null, lastActivityAt: '2026-01-01T00:00:00Z',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/user',
        expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-xxx' }) }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects?per_page=100&page=1&statistics=true',
        expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-xxx' }) }),
      );

      vi.unstubAllGlobals();
    });

    it('listAccessibleRepos works without a token — returns only public projects', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      const client = new GitLabClient('https://gitlab.example.com');

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          { id: 9, path: 'public-repo', web_url: 'https://gitlab.example.com/g/public-repo', description: null, default_branch: 'main', statistics: { repository_size: 50 }, last_activity_at: '2026-04-01T00:00:00Z' },
        ]),
      });
      vi.stubGlobal('fetch', mockFetch);

      const repos = await client.listAccessibleRepos();

      expect(repos).toHaveLength(1);
      expect(repos[0].externalId).toBe('9');
      // No /user auth probe when token is absent — go straight to /projects
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects?per_page=100&page=1&statistics=true',
        expect.objectContaining({ headers: expect.not.objectContaining({ 'PRIVATE-TOKEN': expect.anything() }) }),
      );

      vi.unstubAllGlobals();
    });
  });

  describe('BitBucketClient', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('getRepo should fetch a single repo', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          uuid: '{abc-123}', slug: 'myrepo', full_name: 'myws/myrepo',
          links: { clone: [{ name: 'https', href: 'https://bitbucket.org/myws/myrepo.git' }] },
          description: 'A repo', mainbranch: { name: 'main' },
          size: 50000, language: 'Python', updated_on: '2026-02-01T00:00:00Z',
        }),
      } as any);
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0');
      const repo = await client.getRepo('myws', 'myrepo');
      expect(repo).toEqual({
        externalId: '{abc-123}', name: 'myrepo', url: 'https://bitbucket.org/myws/myrepo.git',
        description: 'A repo', defaultBranch: 'main', sizeBytes: 50000,
        primaryLanguage: 'Python', lastActivityAt: '2026-02-01T00:00:00Z',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/myws/myrepo',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it('validateToken returns true for valid token', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'valid-token', 'user@example.com');
      const result = await client.validateToken('myworkspace');
      expect(result).toEqual({ valid: true, username: 'user@example.com' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/myworkspace?pagelen=1',
        expect.objectContaining({ headers: expect.objectContaining({
          Authorization: expect.stringContaining('Basic '),
        }) }),
      );
    });

    it('validateToken uses Basic auth with email', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'token', 'test@test.com');
      await client.validateToken('ws');
      const expectedAuth = `Basic ${Buffer.from('test@test.com:token').toString('base64')}`;
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expectedAuth }) }),
      );
    });

    it('validateToken flags a 401 as an invalid token', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }));

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'bad-token', 'user@example.com');
      const result = await client.validateToken('myworkspace');
      expect(result).toMatchObject({ valid: false, reason: 'invalid_token' });
    });

    it('validateToken reports a network/TLS failure as "network", NOT an invalid token', async () => {
      // fetch rejects on a TLS/cert/connection error — the token may be perfectly fine.
      const { BitBucketClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('SELF_SIGNED_CERT_IN_CHAIN')));

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'token', 'user@example.com');
      const result = await client.validateToken('myworkspace');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('network');
      expect(result.reason).not.toBe('invalid_token');
      expect(result.detail).toContain('SELF_SIGNED_CERT_IN_CHAIN');
    });

    it('validateToken distinguishes 403 (forbidden) and 404 (not found)', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'token', 'user@example.com');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 403 }));
      expect((await client.validateToken('ws')).reason).toBe('forbidden');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }));
      expect((await client.validateToken('ws')).reason).toBe('not_found');
    });

    it('detectScopes parses x-oauth-scopes header', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [] }),
        headers: new Headers({ 'x-oauth-scopes': 'repository:read, pullrequest:read, webhook' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'token', 'user@example.com');
      const scopes = await client.detectScopes('myworkspace');
      expect(scopes).toEqual(['repository:read', 'pullrequest:read', 'webhook']);
    });

    it('detectScopes returns empty array when not ok', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'token', 'user@example.com');
      const scopes = await client.detectScopes('myworkspace');
      expect(scopes).toEqual([]);
    });

    it('detectScopes returns empty array when header missing', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [] }),
        headers: new Headers(),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'token', 'user@example.com');
      const scopes = await client.detectScopes('myworkspace');
      expect(scopes).toEqual([]);
    });

    it('listRepos uses Basic auth when email is set', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [], next: null }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const email = 'user@example.com';
      const token = 'app-pass-123';
      const client = new BitBucketClient('https://api.bitbucket.org/2.0', token, email);
      await client.listRepos('my-workspace', 'workspace');

      const expectedAuth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/repositories/my-workspace'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: expectedAuth }),
        }),
      );
    });

    it('listRepos uses Bearer auth when no email is set', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [], next: null }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const token = 'oauth-token';
      const client = new BitBucketClient('https://api.bitbucket.org/2.0', token);
      await client.listRepos('my-workspace', 'workspace');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/repositories/my-workspace'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
        }),
      );
    });

    it('extracts size, language, and updated_on metadata', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          values: [{
            uuid: '{abc}',
            slug: 'my-repo',
            links: {
              clone: [{ name: 'https', href: 'https://bitbucket.org/ws/my-repo.git' }],
              html: { href: 'https://bitbucket.org/ws/my-repo' },
            },
            description: 'test',
            mainbranch: { name: 'main' },
            size: 1048576,
            language: 'Python',
            updated_on: '2025-01-15T10:30:00Z',
          }],
          next: null,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'token', 'user@test.com');
      const repos = await client.listRepos('ws', 'workspace');

      expect(repos[0].sizeBytes).toBe(1048576);
      expect(repos[0].primaryLanguage).toBe('Python');
      expect(repos[0].lastActivityAt).toBe('2025-01-15T10:30:00Z');

      vi.unstubAllGlobals();
    });

  });

  describe('createClient factory', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('passes email to BitBucketClient for Basic auth', async () => {
      const { createClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '' },
      });
      vi.stubGlobal('fetch', mockFetch);

      const email = 'factory@example.com';
      const token = 'factory-token';
      const client = createClient('bitbucket', 'https://api.bitbucket.org/2.0', token, email);
      // Trigger a fetch to verify the auth header
      await (client as any).detectScopes('ws');

      const expectedAuth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: expectedAuth }),
        }),
      );
    });

    it('creates BitBucketClient with Bearer auth when no email', async () => {
      const { createClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '' },
      });
      vi.stubGlobal('fetch', mockFetch);

      const token = 'bearer-token';
      const client = createClient('bitbucket', 'https://api.bitbucket.org/2.0', token);
      await (client as any).detectScopes('ws');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
        }),
      );
    });
  });

  describe('stripEmbeddedUsername', () => {
    it('strips username from Bitbucket HTTPS URL', async () => {
      const { stripEmbeddedUsername } = await import('./git-providers.ts');
      expect(stripEmbeddedUsername('https://test-user@bitbucket.org/test-workspace/sample-repo.git'))
        .toBe('https://bitbucket.org/test-workspace/sample-repo.git');
    });

    it('strips username from GitHub HTTPS URL', async () => {
      const { stripEmbeddedUsername } = await import('./git-providers.ts');
      expect(stripEmbeddedUsername('https://user@github.com/org/repo.git'))
        .toBe('https://github.com/org/repo.git');
    });

    it('strips username and password', async () => {
      const { stripEmbeddedUsername } = await import('./git-providers.ts');
      expect(stripEmbeddedUsername('https://user:pass@bitbucket.org/org/repo.git'))
        .toBe('https://bitbucket.org/org/repo.git');
    });

    it('returns URL unchanged when no embedded username', async () => {
      const { stripEmbeddedUsername } = await import('./git-providers.ts');
      expect(stripEmbeddedUsername('https://bitbucket.org/org/repo.git'))
        .toBe('https://bitbucket.org/org/repo.git');
    });

    it('returns non-URL strings unchanged', async () => {
      const { stripEmbeddedUsername } = await import('./git-providers.ts');
      expect(stripEmbeddedUsername('/local/path')).toBe('/local/path');
    });

    it('returns empty string unchanged', async () => {
      const { stripEmbeddedUsername } = await import('./git-providers.ts');
      expect(stripEmbeddedUsername('')).toBe('');
    });
  });

  describe('buildAuthCloneUrl', () => {
    it('uses x-bitbucket-api-token-auth for Bitbucket even when email is provided', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      const result = buildAuthCloneUrl('bitbucket', 'https://bitbucket.org/org/repo.git', 'my-token', 'dev@co.com');
      // Bitbucket API tokens always use x-bitbucket-api-token-auth for git clone, email is only for REST API
      expect(result).toBe('https://x-bitbucket-api-token-auth:my-token@bitbucket.org/org/repo.git');
    });

    it('uses x-bitbucket-api-token-auth for Bitbucket when no email', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      const result = buildAuthCloneUrl('bitbucket', 'https://bitbucket.org/org/repo.git', 'my-token');
      expect(result).toBe('https://x-bitbucket-api-token-auth:my-token@bitbucket.org/org/repo.git');
    });

    it('injects x-access-token for GitHub', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      const result = buildAuthCloneUrl('github', 'https://github.com/org/repo.git', 'ghp_abc123');
      expect(result).toBe('https://x-access-token:ghp_abc123@github.com/org/repo.git');
    });

    it('injects oauth2 for GitLab', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      const result = buildAuthCloneUrl('gitlab', 'https://gitlab.com/org/repo.git', 'glpat-xyz');
      expect(result).toBe('https://oauth2:glpat-xyz@gitlab.com/org/repo.git');
    });

    it('returns URL unchanged when no token', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      const url = 'https://github.com/org/repo.git';
      expect(buildAuthCloneUrl('github', url)).toBe(url);
      expect(buildAuthCloneUrl('github', url, '')).toBe(url);
    });

    it('returns URL unchanged for unknown provider', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      const url = 'https://example.com/org/repo.git';
      expect(buildAuthCloneUrl('unknown', url, 'token')).toBe(url);
    });

    it('returns URL unchanged for non-HTTP URLs', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      const url = 'git@github.com:org/repo.git';
      expect(buildAuthCloneUrl('github', url, 'token')).toBe(url);
    });

    it('returns URL unchanged for local provider', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      expect(buildAuthCloneUrl('local', '/local/path', 'token')).toBe('/local/path');
    });

    it('encodes special characters in token', async () => {
      const { buildAuthCloneUrl } = await import('./git-providers.ts');
      const result = buildAuthCloneUrl('github', 'https://github.com/org/repo.git', 'tok/en+special');
      const parsed = new URL(result);
      // URL.password returns percent-encoded form
      expect(decodeURIComponent(parsed.password)).toBe('tok/en+special');
    });
  });

  describe('BitBucketClient.listRepos strips embedded usernames', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('strips username from Bitbucket HTTPS clone links', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          values: [{
            uuid: '{abc}',
            slug: 'my-repo',
            links: {
              clone: [
                { name: 'https', href: 'https://test-user@bitbucket.org/test-workspace/my-repo.git' },
                { name: 'ssh', href: 'git@bitbucket.org:test-workspace/my-repo.git' },
              ],
              html: { href: 'https://bitbucket.org/test-workspace/my-repo' },
            },
            description: 'test',
            mainbranch: { name: 'main' },
          }],
          next: null,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0', 'token', 'user@example.com');
      const repos = await client.listRepos('test-workspace', 'workspace');
      expect(repos[0].url).toBe('https://bitbucket.org/test-workspace/my-repo.git');
    });
  });

  describe('retry behavior (fetchWithRetry)', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('GitHub getRepo retries on 500 and succeeds on the second attempt', async () => {
      vi.useFakeTimers();
      const { GitHubClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 1, name: 'myrepo', html_url: 'https://github.com/o/myrepo', description: null, default_branch: 'main' }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitHubClient('https://api.github.com');
      const promise = client.getRepo('o', 'myrepo');
      await vi.advanceTimersByTimeAsync(500);
      const repo = await promise;

      expect(repo.name).toBe('myrepo');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('GitHub getRepo retries network errors and succeeds', async () => {
      vi.useFakeTimers();
      const { GitHubClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 1, name: 'r', html_url: 'u', description: null, default_branch: 'main' }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitHubClient('https://api.github.com');
      const promise = client.getRepo('o', 'r');
      await vi.advanceTimersByTimeAsync(500);
      const repo = await promise;

      expect(repo.name).toBe('r');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('does NOT retry 4xx responses', async () => {
      const { GitHubClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'nope' });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitHubClient('https://api.github.com');
      await expect(client.getRepo('o', 'missing')).rejects.toThrow(/404/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('surfaces the 5xx status after exhausting retries (3 attempts)', async () => {
      vi.useFakeTimers();
      const { GitLabClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'bad gateway' });
      vi.stubGlobal('fetch', mockFetch);

      const client = new GitLabClient('https://gitlab.com');
      const promise = client.getRepo('g', 'r');
      const guard = promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(1500); // 500 + 1000 backoff
      await expect(promise).rejects.toThrow(/502/);
      await guard;
      expect(mockFetch).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    it('propagates a persistent network error after retries', async () => {
      vi.useFakeTimers();
      const { BitBucketClient } = await import('./git-providers.ts');
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND'));
      vi.stubGlobal('fetch', mockFetch);

      const client = new BitBucketClient('https://api.bitbucket.org/2.0');
      const promise = client.getRepo('ws', 'r');
      const guard = promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(1500);
      await expect(promise).rejects.toThrow('getaddrinfo ENOTFOUND');
      await guard;
      expect(mockFetch).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });
  });

  describe('rate-limit classification is consistent across providers', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('GitLab getRepo throws RATE_LIMITED on 429', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
      const client = new GitLabClient('https://gitlab.com');
      await expect(client.getRepo('g', 'r')).rejects.toThrow('RATE_LIMITED');
    });

    it('GitLab listRepos (group) throws RATE_LIMITED on 429', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
      const client = new GitLabClient('https://gitlab.com');
      await expect(client.listRepos('g', 'group')).rejects.toThrow('RATE_LIMITED');
    });

    it('GitLab listRepos (user) throws RATE_LIMITED on 429', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
      const client = new GitLabClient('https://gitlab.com');
      await expect(client.listRepos('someone', 'user')).rejects.toThrow('RATE_LIMITED');
    });

    it('GitLab listAccessibleRepos throws RATE_LIMITED on 429', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
      const client = new GitLabClient('https://gitlab.com');
      await expect(client.listAccessibleRepos()).rejects.toThrow('RATE_LIMITED');
    });

    it('GitLab detectOrgType throws RATE_LIMITED on 429 instead of "not found"', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
      const client = new GitLabClient('https://gitlab.com');
      await expect(client.detectOrgType('g')).rejects.toThrow('RATE_LIMITED');
    });

    it('Bitbucket getRepo throws RATE_LIMITED on 429', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
      const client = new BitBucketClient('https://api.bitbucket.org/2.0');
      await expect(client.getRepo('ws', 'r')).rejects.toThrow('RATE_LIMITED');
    });

    it('Bitbucket listRepos throws RATE_LIMITED on 429', async () => {
      const { BitBucketClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
      const client = new BitBucketClient('https://api.bitbucket.org/2.0');
      await expect(client.listRepos('ws', 'workspace')).rejects.toThrow('RATE_LIMITED');
    });

    it('GitLab non-429 errors keep the generic API error message', async () => {
      const { GitLabClient } = await import('./git-providers.ts');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }));
      const client = new GitLabClient('https://gitlab.com');
      await expect(client.getRepo('g', 'r')).rejects.toThrow('GitLab API error: 404');
    });
  });

  describe('LocalDirectoryClient', () => {
    it('lists git repos in directory', async () => {
      const { LocalDirectoryClient } = await import('./git-providers.ts');
      const client = new LocalDirectoryClient();

      expect(client).toBeDefined();
      expect(typeof client.listRepos).toBe('function');
    });
  });
});
