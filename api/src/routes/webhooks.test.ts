import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { createHmac } from 'crypto';

// Mock entities
const mockUpsertPullRequest = vi.fn();
const mockCreateWorkspaceEvent = vi.fn();
vi.mock('../orchestrator/entities.ts', () => ({
  upsertPullRequest: (...args: any[]) => mockUpsertPullRequest(...args),
  createWorkspaceEvent: (...args: any[]) => mockCreateWorkspaceEvent(...args),
}));

// Mock vault
const mockGetSecret = vi.fn();
vi.mock('../lib/vault.ts', () => ({
  getSecret: (...args: any[]) => mockGetSecret(...args),
}));

// Mock createScan
const mockCreateScan = vi.fn();
vi.mock('../orchestrator/db.ts', () => ({
  createScan: (...args: any[]) => mockCreateScan(...args),
}));

// Mock BitBucketClient
const mockGetPullRequestDiff = vi.fn();
vi.mock('../orchestrator/git-providers.ts', () => ({
  BitBucketClient: class MockBitBucketClient {
    constructor() {}
    getPullRequestDiff = mockGetPullRequestDiff;
  },
}));

import { db } from '../db/index.ts';
const mockDb = db as any;

let app: FastifyInstance;

// Sample Bitbucket webhook payload
function makePrPayload(overrides: Record<string, any> = {}) {
  return {
    repository: {
      full_name: 'myworkspace/my-repo',
      name: 'my-repo',
      ...overrides.repository,
    },
    pullrequest: {
      id: 42,
      title: 'Fix the bug',
      description: 'Fixes #123',
      state: 'OPEN',
      author: { display_name: 'John Doe', username: 'johndoe' },
      source: {
        branch: { name: 'feature/fix' },
        commit: { hash: 'abc123' },
      },
      destination: {
        branch: { name: 'main' },
      },
      links: {
        html: { href: 'https://bitbucket.org/myworkspace/my-repo/pull-requests/42' },
      },
      ...overrides.pullrequest,
    },
  };
}

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const mod = await import('./webhooks.ts');
  await app.register(mod.webhookRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Re-wire the chainable mock so each method returns the mock itself
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

// ── Non-PR events ──────────────────────────────────────────────

describe('POST /webhooks/bitbucket — non-PR events', () => {
  it('ignores unknown event types with 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'repo:push',
      },
      payload: JSON.stringify({ repository: { full_name: 'test/repo' } }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ignored');
  });

  it('ignores when x-event-key header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ repository: { full_name: 'test/repo' } }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ignored');
  });
});

// ── Invalid payloads ────────────────────────────────────────────

describe('POST /webhooks/bitbucket — invalid payloads', () => {
  it('returns 400 for invalid JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: 'not-json{{{',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid JSON');
  });

  it('returns 400 when repository info is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify({ pullrequest: { id: 1 } }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Missing repository info');
  });
});

// ── Integration not found ───────────────────────────────────────

describe('POST /webhooks/bitbucket — integration lookup', () => {
  it('returns 404 when no matching integration found', async () => {
    // Mock: db.select().from(sources).where(...) => []
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('No matching source found');
  });
});

// ── HMAC verification ────────────────────────────────────────────

describe('POST /webhooks/bitbucket — HMAC verification', () => {
  it('rejects requests with invalid HMAC signature', async () => {
    const integration = {
      id: 1,
      workspaceId: 10,
      provider: 'bitbucket',
      orgName: 'myworkspace',
      baseUrl: 'https://api.bitbucket.org/2.0',
      webhookId: 'hook-uuid',
    };

    // Mock: db.select().from(sources).where(...) => [integration]
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockResolvedValueOnce([integration]);

    // Mock vault: webhook_secret returns the secret
    mockGetSecret.mockResolvedValueOnce('super-secret-key');

    const payload = JSON.stringify(makePrPayload());

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
        'x-hub-signature': 'bad-signature',
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid signature');
  });

  it('accepts requests with valid HMAC signature', async () => {
    const secret = 'super-secret-key';
    const integration = {
      id: 1,
      workspaceId: 10,
      provider: 'bitbucket',
      orgName: 'myworkspace',
      baseUrl: 'https://api.bitbucket.org/2.0',
      webhookId: 'hook-uuid',
    };

    const payload = JSON.stringify(makePrPayload());
    const validSignature = createHmac('sha256', secret).update(payload).digest('hex');

    // Mock: db.select().from(sources).where(...) => [integration]
    // First call: integration lookup
    // Second call: repository lookup
    const repo = { id: 5, name: 'my-repo', repoUrl: 'https://bitbucket.org/myworkspace/my-repo', sourceId: 1, teamId: 2 };
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where
      .mockResolvedValueOnce([integration])  // integration lookup
      .mockResolvedValueOnce([repo]);        // repo lookup

    mockUpsertPullRequest.mockResolvedValueOnce({ id: 100, externalId: 42 });
    // First getSecret call: webhook_secret; second: access_token
    mockGetSecret.mockResolvedValueOnce(secret);        // webhook_secret
    mockGetSecret.mockResolvedValueOnce('tok123');      // access_token
    mockGetPullRequestDiff.mockResolvedValueOnce(
      'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+line',
    );
    mockCreateScan.mockResolvedValueOnce({ id: 'scan-uuid', status: 'queued' });
    mockCreateWorkspaceEvent.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
        'x-hub-signature': validSignature,
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('scan_enqueued');
  });
});

// ── Repository not tracked ──────────────────────────────────────

describe('POST /webhooks/bitbucket — repository not tracked', () => {
  it('returns 200 with ignored status when repo is not tracked', async () => {
    const integration = {
      id: 1,
      workspaceId: 10,
      provider: 'bitbucket',
      orgName: 'myworkspace',
      baseUrl: 'https://api.bitbucket.org/2.0',
      webhookId: null,
    };

    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where
      .mockResolvedValueOnce([integration])  // integration lookup
      .mockResolvedValueOnce([]);            // repo lookup — empty

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ignored');
    expect(res.json().reason).toBe('repository not tracked');
  });
});

// ── Successful PR event handling ────────────────────────────────

describe('POST /webhooks/bitbucket — pullrequest:created', () => {
  const integration = {
    id: 1,
    workspaceId: 10,
    provider: 'bitbucket',
    orgName: 'myworkspace',
    baseUrl: 'https://api.bitbucket.org/2.0',
    webhookId: null,
  };

  const repo = {
    id: 5,
    name: 'my-repo',
    repoUrl: 'https://bitbucket.org/myworkspace/my-repo',
    sourceId: 1,
    teamId: 2,
  };

  function setupMocks() {
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where
      .mockResolvedValueOnce([integration])
      .mockResolvedValueOnce([repo]);

    mockUpsertPullRequest.mockResolvedValueOnce({ id: 100, externalId: 42 });
    mockGetSecret.mockResolvedValueOnce('tok123'); // access_token
    mockGetPullRequestDiff.mockResolvedValueOnce(
      'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,4 @@\n+new line\ndiff --git a/README.md b/README.md\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+# Hello',
    );
    mockCreateScan.mockResolvedValueOnce({ id: 'scan-uuid-1', status: 'queued' });
    mockCreateWorkspaceEvent.mockResolvedValueOnce({});
  }

  it('upserts pull request record', async () => {
    setupMocks();

    await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(mockUpsertPullRequest).toHaveBeenCalledWith({
      repositoryId: 5,
      workspaceId: 10,
      externalId: 42,
      title: 'Fix the bug',
      description: 'Fixes #123',
      author: 'John Doe',
      sourceBranch: 'feature/fix',
      targetBranch: 'main',
      status: 'open',
      prUrl: 'https://bitbucket.org/myworkspace/my-repo/pull-requests/42',
    });
  });

  it('creates a scan with PR fields', async () => {
    setupMocks();

    await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(mockCreateScan).toHaveBeenCalledWith({
      repoUrl: 'https://bitbucket.org/myworkspace/my-repo',
      repoName: 'my-repo',
      branch: 'feature/fix',
      commitHash: 'abc123',
      workspaceId: 10,
      repositoryId: 5,
      pullRequestId: 100,
      scanType: 'pr',
    });
  });

  it('creates scan with correct PR data for DB worker pickup', async () => {
    setupMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(res.statusCode).toBe(200);
    expect(mockCreateScan).toHaveBeenCalledWith(expect.objectContaining({
      repoName: 'my-repo',
      branch: 'feature/fix',
      commitHash: 'abc123',
      scanType: 'pr',
      pullRequestId: 100,
    }));
  });

  it('creates workspace event', async () => {
    setupMocks();

    await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(
      10,
      'pr_scan_triggered',
      expect.objectContaining({
        repository_name: 'my-repo',
        pr_id: 42,
        pr_title: 'Fix the bug',
        scan_id: 'scan-uuid-1',
      }),
    );
  });

  it('returns scan info in response', async () => {
    setupMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('scan_enqueued');
    expect(body.scan_id).toBe('scan-uuid-1');
    expect(body.pull_request_id).toBe(100);
    expect(body.changed_files).toBeGreaterThan(0);
  });

  it('parses diff to extract changed file paths and reports count', async () => {
    setupMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:created',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    // The diff contains src/main.ts and README.md (plus /dev/null which should be filtered)
    const body = res.json();
    expect(body.changed_files).toBe(2);
  });
});

// ── pullrequest:updated ─────────────────────────────────────────

describe('POST /webhooks/bitbucket — pullrequest:updated', () => {
  it('also triggers scan for pullrequest:updated event', async () => {
    const integration = {
      id: 1,
      workspaceId: 10,
      provider: 'bitbucket',
      orgName: 'myworkspace',
      baseUrl: 'https://api.bitbucket.org/2.0',
    };
    const repo = { id: 5, name: 'my-repo', repoUrl: 'https://bitbucket.org/myworkspace/my-repo', sourceId: 1 };

    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where
      .mockResolvedValueOnce([integration])
      .mockResolvedValueOnce([repo]);

    mockUpsertPullRequest.mockResolvedValueOnce({ id: 200, externalId: 42 });
    mockGetSecret.mockResolvedValueOnce(null); // no access_token
    mockCreateScan.mockResolvedValueOnce({ id: 'scan-uuid-2', status: 'queued' });
    mockCreateWorkspaceEvent.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:updated',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('scan_enqueued');
    expect(mockCreateScan).toHaveBeenCalled();
  });

  it('proceeds with zero changed files when no credential', async () => {
    const integration = {
      id: 1,
      workspaceId: 10,
      provider: 'bitbucket',
      orgName: 'myworkspace',
      baseUrl: 'https://api.bitbucket.org/2.0',
    };
    const repo = { id: 5, name: 'my-repo', repoUrl: 'https://bitbucket.org/myworkspace/my-repo', sourceId: 1 };

    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where
      .mockResolvedValueOnce([integration])
      .mockResolvedValueOnce([repo]);

    mockUpsertPullRequest.mockResolvedValueOnce({ id: 200, externalId: 42 });
    mockGetSecret.mockResolvedValueOnce(null); // no access_token
    mockCreateScan.mockResolvedValueOnce({ id: 'scan-uuid-3', status: 'queued' });
    mockCreateWorkspaceEvent.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:updated',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    const body = res.json();
    expect(body.changed_files).toBe(0);
  });
});

// ── pullrequest:declined/merged ─────────────────────────────────

describe('POST /webhooks/bitbucket — pullrequest:declined/merged', () => {
  it('upserts PR but does not trigger scan for declined event', async () => {
    const integration = {
      id: 1,
      workspaceId: 10,
      provider: 'bitbucket',
      orgName: 'myworkspace',
      baseUrl: 'https://api.bitbucket.org/2.0',
    };
    const repo = { id: 5, name: 'my-repo', repoUrl: 'https://bitbucket.org/myworkspace/my-repo', sourceId: 1 };

    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where
      .mockResolvedValueOnce([integration])
      .mockResolvedValueOnce([repo]);

    mockUpsertPullRequest.mockResolvedValueOnce({ id: 300, externalId: 42 });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-event-key': 'pullrequest:rejected',
      },
      payload: JSON.stringify(makePrPayload()),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pr_updated');
    expect(mockUpsertPullRequest).toHaveBeenCalled();
    expect(mockCreateScan).not.toHaveBeenCalled();
  });
});
