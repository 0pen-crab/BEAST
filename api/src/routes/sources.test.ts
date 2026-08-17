import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { sourceRoutes } from './sources.ts';
import multipart from '@fastify/multipart';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock auth middleware so route guards are no-ops in unit tests
vi.mock('../middleware/auth.ts', () => ({
  requireRole: () => async () => {},
}));

vi.mock('../lib/authorize.ts', () => ({
  authorize: vi.fn(async (request: any) => { request.authorized = true; }),
  authorizePublic: vi.fn((request: any) => { request.authorized = true; }),
  ForbiddenError: class ForbiddenError extends Error {
    statusCode = 403;
    constructor(msg = 'Forbidden') { super(msg); }
  },
}));

vi.mock('../orchestrator/entities.ts', () => ({
  createSource: vi.fn(),
  getSource: vi.fn(),
  listSources: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  createWorkspaceEvent: vi.fn(),
  ensureTeam: vi.fn(),
}));

vi.mock('../lib/vault.ts', () => ({
  setSecret: vi.fn(),
  getSecret: vi.fn(),
  deleteOwnerSecrets: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock('../orchestrator/git-providers.ts', () => ({
  parseGitUrl: vi.fn(),
  createClient: vi.fn(),
  isBitbucketAccessToken: (token: string) => token.startsWith('ATCTT3x'),
  normalizeBaseUrl: (url: string) => url.replace(/\/+$/, ''),
  GitHubClient: vi.fn(),
  GitLabClient: vi.fn(),
  BitBucketClient: vi.fn(),
  LocalDirectoryClient: vi.fn(),
}));

vi.mock('../db/index.ts', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../orchestrator/git-sync.ts', () => ({
  syncSource: vi.fn(),
}));

import {
  createSource,
  getSource,
  listSources,
  updateSource,
  deleteSource,
  ensureTeam,
  createWorkspaceEvent,
} from '../orchestrator/entities.ts';
import { getSecret } from '../lib/vault.ts';
import { parseGitUrl, createClient, BitBucketClient } from '../orchestrator/git-providers.ts';
import { db } from '../db/index.ts';

describe('Sources API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.register(multipart);
    app.register(sourceRoutes, { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function mockDbSelectEmpty() {
    const mockLimit = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });
  }

  function mockDbDeleteWhere() {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    (db.delete as any).mockReturnValue({ where: mockWhere });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/sources', () => {
    it('should connect a public source and return discovered repos', async () => {
      mockDbSelectEmpty();
      (parseGitUrl as any).mockReturnValue({
        provider: 'github',
        baseUrl: 'https://api.github.com',
        orgName: 'test-org',
      });

      const mockClient = {
        detectOrgType: vi.fn().mockResolvedValue('organization'),
        listRepos: vi.fn().mockResolvedValue([
          { externalId: '1', name: 'repo-a', url: 'https://github.com/test-org/repo-a', description: 'A', defaultBranch: 'main' },
          { externalId: '2', name: 'repo-b', url: 'https://github.com/test-org/repo-b', description: 'B', defaultBranch: 'main' },
        ]),
      };
      (createClient as any).mockReturnValue(mockClient);
      (createSource as any).mockResolvedValue({ id: 1, workspaceId: 1, provider: 'github', orgName: 'test-org' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1, url: 'https://github.com/test-org' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.source.id).toBe(1);
      expect(body.discovered_repos).toHaveLength(2);
      expect(body.discovered_repos[0].slug).toBe('repo-a');
      expect(body.discovered_repos[0].imported).toBe(false);
    });

    it('should return 400 for invalid URL', async () => {
      (parseGitUrl as any).mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1, url: 'not-a-git-url' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should accept provider + org_name for private source', async () => {
      mockDbSelectEmpty();
      const mockClient = {
        detectOrgType: vi.fn().mockResolvedValue('organization'),
        listRepos: vi.fn().mockResolvedValue([]),
      };
      (createClient as any).mockReturnValue(mockClient);
      (createSource as any).mockResolvedValue({ id: 2, workspaceId: 1, provider: 'gitlab', orgName: 'private-org' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1, provider: 'gitlab', org_name: 'private-org', access_token: 'tok' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().source.id).toBe(2);
    });

    it('reports a Bitbucket network/TLS failure as a connection error (502), not "invalid token"', async () => {
      // The user hit this: a corporate TLS-inspecting proxy made token validation throw,
      // and the UI said "Invalid token" even though the token was fine.
      mockDbSelectEmpty();
      (parseGitUrl as any).mockReturnValue(null); // provider+org_name path
      (createClient as any).mockReturnValue({
        detectOrgType: vi.fn().mockResolvedValue('workspace'),
        listRepos: vi.fn().mockResolvedValue([]),
      });
      (BitBucketClient as any).mockImplementation(function (this: any) {
        this.validateToken = vi.fn().mockResolvedValue({ valid: false, username: null, reason: 'network', detail: 'SELF_SIGNED_CERT_IN_CHAIN' });
        this.detectScopes = vi.fn().mockResolvedValue([]);
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1, provider: 'bitbucket', org_name: 'enaminedev', access_token: 'tok', username: 'me@enamine.net' },
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().reason).toBe('network');
      expect(res.json().error.toLowerCase()).not.toContain('invalid');
      expect(res.json().error.toLowerCase()).toContain('network');
    });

    it('still reports a genuinely bad Bitbucket token as invalid (400)', async () => {
      mockDbSelectEmpty();
      (parseGitUrl as any).mockReturnValue(null);
      (createClient as any).mockReturnValue({
        detectOrgType: vi.fn().mockResolvedValue('workspace'),
        listRepos: vi.fn().mockResolvedValue([]),
      });
      (BitBucketClient as any).mockImplementation(function (this: any) {
        this.validateToken = vi.fn().mockResolvedValue({ valid: false, username: null, reason: 'invalid_token' });
        this.detectScopes = vi.fn().mockResolvedValue([]);
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1, provider: 'bitbucket', org_name: 'enaminedev', access_token: 'bad', username: 'me@enamine.net' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.toLowerCase()).toContain('invalid');
    });

    it('should pass username to createClient for GitHub repo discovery', async () => {
      mockDbSelectEmpty();
      (parseGitUrl as any).mockReturnValue(null); // force provider+org_name path

      const mockClient = {
        detectOrgType: vi.fn().mockResolvedValue('organization'),
        listRepos: vi.fn().mockResolvedValue([
          { externalId: '1', name: 'repo-a', url: 'https://github.com/org/repo-a', description: 'A' },
        ]),
      };
      (createClient as any).mockReturnValue(mockClient);
      (createSource as any).mockResolvedValue({ id: 3, workspaceId: 1, provider: 'github', orgName: 'my-org' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: {
          workspace_id: 1,
          provider: 'github',
          org_name: 'my-org',
          access_token: 'ghp_token',
          username: 'user@example.com',
        },
      });

      expect(res.statusCode).toBe(201);
      // createClient should be called with username for both detectOrgType and discovery
      const calls = (createClient as any).mock.calls;
      // Both calls should pass username as 4th arg
      expect(calls[0][3]).toBe('user@example.com');
      expect(calls[1][3]).toBe('user@example.com');
    });

    it('should return error when repo discovery fails', async () => {
      mockDbSelectEmpty();
      (parseGitUrl as any).mockReturnValue({
        provider: 'github',
        baseUrl: 'https://api.github.com',
        orgName: 'test-org',
      });

      const mockClient = {
        detectOrgType: vi.fn().mockResolvedValue('organization'),
        listRepos: vi.fn().mockRejectedValue(new Error('GitHub API error: 401')),
      };
      (createClient as any).mockReturnValue(mockClient);
      (createSource as any).mockResolvedValue({ id: 4, workspaceId: 1, provider: 'github', orgName: 'test-org' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1, url: 'https://github.com/test-org' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.discovered_repos).toEqual([]);
      expect(body.discovery_error).toBe('GitHub API error: 401');
    });

    it('returns 422 and deletes orphan source when single-repo discovery fails', async () => {
      mockDbSelectEmpty();
      (parseGitUrl as any).mockReturnValue({
        provider: 'github',
        orgName: 'myorg',
        repoSlug: 'private-repo',
        baseUrl: 'https://api.github.com',
      });

      const mockClient = {
        detectOrgType: vi.fn(),
        getRepo: vi.fn().mockRejectedValue(new Error('GitHub API error: 404')),
      };
      (createClient as any).mockReturnValue(mockClient);
      (createSource as any).mockResolvedValue({ id: 99, workspaceId: 1, provider: 'github', orgName: 'myorg' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1, url: 'https://github.com/myorg/private-repo' },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.error).toContain('GitHub API error: 404');
      expect(body.code).toBe('DISCOVERY_FAILED');
      expect(deleteSource).toHaveBeenCalledWith(99);
    });

    it('returns 429 when single-repo discovery hits RATE_LIMITED', async () => {
      mockDbSelectEmpty();
      (parseGitUrl as any).mockReturnValue({
        provider: 'github',
        orgName: 'myorg',
        repoSlug: 'myrepo',
        baseUrl: 'https://api.github.com',
      });

      const mockClient = {
        detectOrgType: vi.fn(),
        getRepo: vi.fn().mockRejectedValue(new Error('RATE_LIMITED')),
      };
      (createClient as any).mockReturnValue(mockClient);
      (createSource as any).mockResolvedValue({ id: 100, workspaceId: 1, provider: 'github', orgName: 'myorg' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1, url: 'https://github.com/myorg/myrepo' },
      });

      expect(res.statusCode).toBe(429);
      expect(deleteSource).toHaveBeenCalledWith(100);
    });

    it('discovers single repo when URL has repo slug', async () => {
      mockDbSelectEmpty();
      (parseGitUrl as any).mockReturnValue({
        provider: 'github',
        orgName: 'myorg',
        repoSlug: 'myrepo',
        baseUrl: 'https://api.github.com',
      });

      const mockClient = {
        detectOrgType: vi.fn(),
        listRepos: vi.fn(),
        getRepo: vi.fn().mockResolvedValue({
          externalId: '123',
          name: 'myrepo',
          url: 'https://github.com/myorg/myrepo',
          description: 'A single repo',
          defaultBranch: 'main',
        }),
      };
      (createClient as any).mockReturnValue(mockClient);
      (createSource as any).mockResolvedValue({ id: 1, workspaceId: 1, provider: 'github', orgName: 'myorg' });
      (ensureTeam as any).mockResolvedValue({ id: 10 });

      // Mock db.insert for auto-import
      const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
      (db.insert as any).mockReturnValue({ values: mockInsertValues });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        headers: { authorization: 'Token test', 'content-type': 'application/json' },
        payload: { workspace_id: 1, url: 'https://github.com/myorg/myrepo' },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.payload);
      expect(data.discovered_repos).toHaveLength(1);
      expect(data.discovered_repos[0].slug).toBe('myrepo');
      // getRepo should be called instead of listRepos
      expect(mockClient.getRepo).toHaveBeenCalledWith('myorg', 'myrepo', undefined);
      expect(mockClient.listRepos).not.toHaveBeenCalled();
      // detectOrgType should NOT be called for single-repo
      expect(mockClient.detectOrgType).not.toHaveBeenCalled();
    });

    it('should return 400 when neither url nor provider+org_name provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { workspace_id: 1 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/sources', () => {
    it('should list sources for a workspace', async () => {
      (listSources as any).mockResolvedValue([
        { id: 1, provider: 'github', orgName: 'test-org', workspaceId: 1 },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/sources?workspace_id=1',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
    });

    it('should return 400 when no workspace_id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sources',
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 when workspace_id is not a positive number', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sources?workspace_id=0',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/sources/:id', () => {
    it('should return a source by id', async () => {
      (getSource as any).mockResolvedValue({ id: 1, provider: 'github' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/sources/1',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(1);
    });

    it('should return 404 for missing source', async () => {
      (getSource as any).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/sources/999',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/sources/:id/repos', () => {
    it('should return repos with imported flag', async () => {
      (getSource as any).mockResolvedValue({ id: 1, provider: 'github', baseUrl: 'https://api.github.com', orgName: 'test-org', orgType: 'organization', credentialUsername: null });
      (getSecret as any).mockResolvedValue(null);

      const mockClient = {
        listRepos: vi.fn().mockResolvedValue([
          { externalId: '1', name: 'repo-a', url: 'https://github.com/test-org/repo-a', description: 'A', defaultBranch: 'main' },
          { externalId: '2', name: 'repo-b', url: 'https://github.com/test-org/repo-b', description: 'B', defaultBranch: 'main' },
        ]),
      };
      (createClient as any).mockReturnValue(mockClient);

      // Mock db.select for existing repos check
      const mockSelectWhere = vi.fn().mockResolvedValue([{ externalId: '1' }]);
      const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
      (db.select as any).mockReturnValue({ from: mockSelectFrom });

      const res = await app.inject({
        method: 'GET',
        url: '/api/sources/1/repos',
      });

      expect(res.statusCode).toBe(200);
      const repos = res.json();
      expect(repos).toHaveLength(2);
      expect(repos[0].imported).toBe(true);
      expect(repos[1].imported).toBe(false);
    });
  });

  describe('POST /api/sources/:id/import', () => {
    it('should import selected repos', async () => {
      (getSource as any).mockResolvedValue({ id: 1, workspaceId: 1, provider: 'github', baseUrl: 'https://api.github.com', orgName: 'test-org', orgType: 'organization', credentialUsername: null });
      (getSecret as any).mockResolvedValue(null);
      (ensureTeam as any).mockResolvedValue({ id: 10 });

      const mockClient = {
        listRepos: vi.fn().mockResolvedValue([
          { externalId: '1', name: 'repo-a', url: 'https://github.com/test-org/repo-a', description: 'A' },
          { externalId: '2', name: 'repo-b', url: 'https://github.com/test-org/repo-b', description: 'B' },
          { externalId: '3', name: 'repo-c', url: 'https://github.com/test-org/repo-c', description: 'C' },
        ]),
      };
      (createClient as any).mockReturnValue(mockClient);

      const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 100 }]);
      const mockOnConflictDoNothing = vi.fn().mockReturnValue({ returning: mockInsertReturning });
      const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
      (db.insert as any).mockReturnValue({ values: mockInsertValues });

      const mockSelectWhere = vi.fn().mockResolvedValue([]);
      const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
      (db.select as any).mockReturnValue({ from: mockSelectFrom });

      (createWorkspaceEvent as any).mockResolvedValue(undefined);
      (updateSource as any).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources/1/import',
        payload: { repos: ['repo-a', 'repo-c'] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.imported).toBe(2);
    });

    it('should store metadata fields on imported repos', async () => {
      (getSource as any).mockResolvedValue({ id: 1, workspaceId: 1, provider: 'github', baseUrl: 'https://api.github.com', orgName: 'test-org', orgType: 'organization', credentialUsername: null });
      (getSecret as any).mockResolvedValue(null);
      (ensureTeam as any).mockResolvedValue({ id: 10 });

      const mockClient = {
        listRepos: vi.fn().mockResolvedValue([
          {
            externalId: '1', name: 'repo-a', url: 'https://github.com/test-org/repo-a',
            description: 'A', sizeBytes: 75082 * 1024, primaryLanguage: 'TypeScript', lastActivityAt: '2026-03-10T14:00:00Z',
          },
        ]),
      };
      (createClient as any).mockReturnValue(mockClient);

      const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 100 }]);
      const mockOnConflictDoNothing = vi.fn().mockReturnValue({ returning: mockInsertReturning });
      const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
      (db.insert as any).mockReturnValue({ values: mockInsertValues });

      const mockSelectWhere = vi.fn().mockResolvedValue([]);
      const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
      (db.select as any).mockReturnValue({ from: mockSelectFrom });

      (createWorkspaceEvent as any).mockResolvedValue(undefined);
      (updateSource as any).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sources/1/import',
        payload: { repos: ['repo-a'] },
      });

      expect(res.statusCode).toBe(200);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sizeBytes: 75082 * 1024,
          primaryLanguage: 'TypeScript',
          lastActivityAt: new Date('2026-03-10T14:00:00Z'),
        }),
      );
    });
  });

  describe('DELETE /api/sources/:id', () => {
    it('should delete a source and unlink repos', async () => {
      mockDbDeleteWhere();
      (deleteSource as any).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/sources/1',
      });

      expect(res.statusCode).toBe(204);
      expect(deleteSource).toHaveBeenCalledWith(1);
    });
  });

  describe('POST /api/repos/add-url', () => {
    it('should create a repo from a public URL', async () => {
      (ensureTeam as any).mockResolvedValue({ id: 10 });

      const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 100, name: 'my-repo' }]);
      const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
      (db.insert as any).mockReturnValue({ values: mockInsertValues });
      (createWorkspaceEvent as any).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/add-url',
        payload: { url: 'https://github.com/user/my-repo', workspace_id: 1 },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('my-repo');
    });

    it('should return 400 when url missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/add-url',
        payload: { workspace_id: 1 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 when workspace_id missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/add-url',
        payload: { url: 'https://github.com/user/my-repo' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should strip .git suffix from URL when extracting name', async () => {
      (ensureTeam as any).mockResolvedValue({ id: 10 });

      const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 101, name: 'my-repo' }]);
      const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
      (db.insert as any).mockReturnValue({ values: mockInsertValues });
      (createWorkspaceEvent as any).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/add-url',
        payload: { url: 'https://github.com/user/my-repo.git', workspace_id: 1 },
      });

      expect(res.statusCode).toBe(201);
      // Verify the insert was called with name stripped of .git
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my-repo' }),
      );
    });
  });

  describe('POST /api/repos/upload', () => {
    let uploadsBase: string;

    beforeAll(() => {
      uploadsBase = mkdtempSync(join(tmpdir(), 'beast-upload-test-'));
      process.env.UPLOADS_PATH = uploadsBase;
    });

    afterAll(() => {
      delete process.env.UPLOADS_PATH;
      rmSync(uploadsBase, { recursive: true, force: true });
    });

    /** Minimal valid POSIX tar (ustar) built in-process — no shell involved. */
    function tarEntry(name: string, content: Buffer): Buffer {
      const header = Buffer.alloc(512);
      header.write(name, 0, 100, 'utf8');
      header.write('0000644\0', 100, 8);
      header.write('0000000\0', 108, 8);
      header.write('0000000\0', 116, 8);
      header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12);
      header.write('00000000000\0', 136, 12);
      header.write('        ', 148, 8); // checksum computed over spaces
      header.write('0', 156, 1);
      header.write('ustar', 257, 5);
      header[262] = 0;
      header.write('00', 263, 2);
      let sum = 0;
      for (const byte of header) sum += byte;
      header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
      const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
      content.copy(padded);
      return Buffer.concat([header, padded]);
    }

    function makeTar(files: Array<[string, string]>): Buffer {
      const entries = files.map(([n, c]) => tarEntry(n, Buffer.from(c)));
      return Buffer.concat([...entries, Buffer.alloc(1024)]);
    }

    function buildMultipart(filename: string, content: Buffer) {
      const boundary = 'X-TEST-BOUNDARY-7f3a';
      const head = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      return {
        payload: Buffer.concat([head, content, tail]),
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      };
    }

    function mockUploadDbInserts() {
      const returningSource = vi.fn().mockResolvedValue([
        { id: 55, workspaceId: 1, provider: 'local', baseUrl: 'local://' },
      ]);
      const returningRepo = vi.fn().mockResolvedValue([{ id: 100, name: 'repo-x' }]);
      (db.insert as any).mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          returning: returningSource,
          onConflictDoUpdate: vi.fn().mockReturnValue({ returning: returningRepo }),
        }),
      }));
      (ensureTeam as any).mockResolvedValue({ id: 10 });
      (createWorkspaceEvent as any).mockResolvedValue(undefined);
    }

    it('rejects a disallowed extension with 400', async () => {
      const { payload, headers } = buildMultipart('evil.sh', Buffer.from('#!/bin/sh\n'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/upload?workspace_id=1',
        payload,
        headers,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Unsupported archive format');
    });

    it('rejects a traversal filename whose basename has a disallowed extension', async () => {
      const { payload, headers } = buildMultipart('../../../etc/cron.d/evil', Buffer.from('x'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/upload?workspace_id=1',
        payload,
        headers,
      });

      expect(res.statusCode).toBe(400);
    });

    it('neutralizes path traversal in the filename via basename()', async () => {
      mockUploadDbInserts();
      const tar = makeTar([['repo-x/file.txt', 'hello\n']]);
      // Hostile client tries to plant the archive OUTSIDE the uploads dir
      const { payload, headers } = buildMultipart('../../escaped.tar', tar);

      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/upload?workspace_id=1',
        payload,
        headers,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().count).toBe(1);
      // Nothing may be written above the uploads base
      expect(existsSync(join(uploadsBase, '..', 'escaped.tar'))).toBe(false);
    });

    it('does not execute shell metacharacters embedded in the filename', async () => {
      mockUploadDbInserts();
      const canary = join(uploadsBase, 'pwned-canary');
      const tar = makeTar([['repo-x/file.txt', 'hello\n']]);
      // With the old execSync template string, $(...) ran inside double quotes.
      const { payload, headers } = buildMultipart(`pwn$(touch ${canary}).tar`, tar);

      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/upload?workspace_id=1',
        payload,
        headers,
      });

      expect(res.statusCode).toBe(201);
      expect(existsSync(canary)).toBe(false);
    });

    it('returns 400 when workspace_id is missing', async () => {
      const { payload, headers } = buildMultipart('repo.tar', makeTar([['a/b.txt', 'x']]));

      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/upload',
        payload,
        headers,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('workspace_id');
    });
  });
});
