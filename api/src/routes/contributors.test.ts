import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// Mock auth middleware so route guards are no-ops in unit tests
vi.mock('../middleware/auth.ts', () => ({
  requireRole: () => async () => {},
}));

// Mock authorize so merge endpoint auth check passes in tests
vi.mock('../lib/authorize.ts', () => ({
  authorize: vi.fn(async (request: any) => { request.authorized = true; }),
  authorizePublic: vi.fn((request: any) => { request.authorized = true; }),
  ForbiddenError: class ForbiddenError extends Error {
    statusCode = 403;
    constructor(msg = 'Forbidden') { super(msg); }
  },
}));

import { db } from '../db/index.ts';

const mockDb = db as any;

let app: FastifyInstance;

// Helper: create a chainable mock that resolves to `value` when awaited.
function chain(value: any = []) {
  const c: any = {};
  for (const method of [
    'select', 'insert', 'update', 'delete',
    'from', 'where', 'set', 'values',
    'returning', 'innerJoin', 'leftJoin',
    'orderBy', 'limit', 'offset', 'groupBy',
    'onConflictDoUpdate', 'onConflictDoNothing',
    'as',
  ]) {
    c[method] = vi.fn(() => c);
  }
  // Make thenable so `await chain(...)` works
  c.then = (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject);
  c.execute = vi.fn().mockResolvedValue(value);
  return c;
}

// Helper: make mockDb.select return a fresh chain each call
function mockSelect(...returnValues: any[]) {
  const chains = returnValues.map((v) => chain(v));
  let callIdx = 0;
  mockDb.select = vi.fn(() => {
    const c = chains[Math.min(callIdx, chains.length - 1)];
    callIdx++;
    return c;
  });
  return chains;
}

function mockInsert(...returnValues: any[]) {
  const chains = returnValues.map((v) => chain(v));
  let callIdx = 0;
  mockDb.insert = vi.fn(() => {
    const c = chains[Math.min(callIdx, chains.length - 1)];
    callIdx++;
    return c;
  });
  return chains;
}

function mockUpdate(...returnValues: any[]) {
  const chains = returnValues.map((v) => chain(v));
  let callIdx = 0;
  mockDb.update = vi.fn(() => {
    const c = chains[Math.min(callIdx, chains.length - 1)];
    callIdx++;
    return c;
  });
  return chains;
}

function mockDelete(...returnValues: any[]) {
  const chains = returnValues.map((v) => chain(v));
  let callIdx = 0;
  mockDb.delete = vi.fn(() => {
    const c = chains[Math.min(callIdx, chains.length - 1)];
    callIdx++;
    return c;
  });
  return chains;
}

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('preHandler', async (request) => {
    request.user = { id: 1, username: 'test', role: 'super_admin', displayName: 'Test', mustChangePassword: false };
  });
  const mod = await import('./contributors.ts');
  await app.register(mod.contributorRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Reset all mock methods on db to default chainable behavior
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
  // Make db.transaction pass through to same mock db (so tx.select/update/delete hit our mocks)
  mockDb.transaction = vi.fn(async (fn: any) => fn(mockDb));
});

// ── Plugin Registration ──────────────────────────────────────

describe('contributorRoutes plugin', () => {
  it('registers without error', () => {
    expect(app).toBeDefined();
  });
});

// ── GET /contributors ──────────────────────────────────────────

describe('GET /contributors', () => {
  it('returns paginated list with count and results', async () => {
    const contribRows = [
      { id: 1, displayName: 'Alice', scoreOverall: 8.5 },
      { id: 2, displayName: 'Bob', scoreOverall: 7.0 },
    ];
    // First db.select() = COUNT query, second = data query
    mockSelect([{ count: 2 }], contribRows);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('count', 2);
    expect(body).toHaveProperty('results');
    expect(body.results).toHaveLength(2);
  });

  it('passes workspace_id filter to query when provided', async () => {
    mockSelect([{ count: 0 }], []);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors?workspace_id=5',
    });

    expect(res.statusCode).toBe(200);
    // Both select chains should have had .where() called
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });

  it('returns empty results when no contributors match', async () => {
    mockSelect([{ count: 0 }], []);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors?search=nobody',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });
});

// ── GET /contributors/:id ──────────────────────────────────────

describe('GET /contributors/:id', () => {
  it('returns a single contributor', async () => {
    const contrib = { id: 1, displayName: 'Alice', scoreOverall: 8.5, emails: ['alice@test.com'] };
    mockSelect([contrib]);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors/1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(contrib);
  });

  it('returns 404 when contributor not found', async () => {
    mockSelect([]);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors/999',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Contributor not found' });
  });
});

// ── GET /contributors/:id/activity ─────────────────────────────

describe('GET /contributors/:id/activity', () => {
  it('returns aggregated activity rows across repos', async () => {
    // The endpoint should SUM commitCount and GROUP BY activityDate
    // so multi-repo data becomes a single row per day
    const aggregated = [
      { activityDate: '2026-01-01', commitCount: 8 },
      { activityDate: '2026-01-02', commitCount: 3 },
    ];
    // First select: contributor existence check; second select: activity query
    mockSelect([{ workspaceId: 1 }], aggregated);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors/1/activity',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(aggregated);
  });

  it('accepts custom weeks parameter', async () => {
    // First select: contributor existence check; second select: activity query
    mockSelect([{ workspaceId: 1 }], []);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors/1/activity?weeks=12',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ── ingestContributors daily_activity per-repo ─────────────────

describe('ingestContributors daily_activity', () => {
  it('passes repoName in daily_activity insert values', async () => {
    // Setup: findOrCreateContributor finds existing contributor
    mockSelect(
      [{ id: 7 }],  // findOrCreateContributor: found
      [{ repoCount: 1, totalCommits: 5, totalLocAdded: 100, totalLocRemoved: 20, firstSeen: null, lastSeen: null }],
      [{ scoreSecurity: null, scoreQuality: null, scorePatterns: null, scoreTesting: null, scoreInnovation: null }],
    );
    const insertChains = mockInsert(
      [],  // upsert repo stats
      [],  // daily_activity insert
    );
    mockUpdate([]);

    const { ingestContributors } = await import('./contributors.ts');
    await ingestContributors({
      repoName: 'my-repo',
      workspaceId: 1,
      contributors: [{
        email: 'dev@test.com',
        name: 'Dev',
        commits: 3,
        loc_added: 50,
        loc_removed: 10,
        daily_activity: { '2026-03-15': 2, '2026-03-16': 1 },
      }],
    });

    // The second+ insert calls should be daily_activity with repoName included
    expect(mockDb.insert).toHaveBeenCalled();
    // Verify values() was called on the daily activity chain with repoName
    const dailyChain = insertChains[1];
    expect(dailyChain.values).toHaveBeenCalled();
    const valuesArg = dailyChain.values.mock.calls[0][0];
    expect(valuesArg).toHaveProperty('repoName', 'my-repo');
  });
});

// ── GET /contributors/:id/repos ────────────────────────────────

describe('GET /contributors/:id/repos', () => {
  it('returns repo stats rows', async () => {
    const repos = [{ id: 1, contributorId: 1, repoName: 'beast', commitCount: 50 }];
    // First select: contributor existence check; second select: repo stats query
    mockSelect([{ workspaceId: 1 }], repos);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors/1/repos',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(repos);
  });
});

// ── GET /contributors/:id/assessments ──────────────────────────

describe('GET /contributors/:id/assessments', () => {
  it('returns assessments rows', async () => {
    const assessments = [
      { id: 1, contributorId: 1, scoreSecurity: 8.0, repoName: 'beast' },
    ];
    // First select: contributor existence check; second select: assessments query
    mockSelect([{ workspaceId: 1 }], assessments);

    const res = await app.inject({
      method: 'GET',
      url: '/contributors/1/assessments',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(assessments);
  });
});

// ── POST /contributors/ingest ──────────────────────────────────

describe('POST /contributors/ingest', () => {
  it('returns 201 with ingested count', async () => {
    // findOrCreateContributor: select (not found) => insert (returning id)
    // upsert repo stats: insert + onConflictDoUpdate
    // recomputeScores: select stats, select scores avg, update contributor
    mockSelect(
      [],                                                             // findOrCreateContributor: SELECT (not found)
      [{ repoCount: 1, totalCommits: 5, totalLocAdded: 100, totalLocRemoved: 20, firstSeen: null, lastSeen: null }], // recomputeScores: stats aggregate
      [{ scoreSecurity: null, scoreQuality: null, scorePatterns: null, scoreTesting: null, scoreInnovation: null }], // recomputeScores: avg scores
    );
    mockInsert(
      [{ id: 10 }],   // findOrCreateContributor: INSERT returning id
      [],              // upsert repo stats
    );
    mockUpdate([]);    // recomputeScores: update contributor

    const res = await app.inject({
      method: 'POST',
      url: '/contributors/ingest',
      payload: {
        repo_name: 'test-repo',
        workspace_id: 1,
        contributors: [
          { email: 'alice@test.com', name: 'Alice', commits: 5, loc_added: 100, loc_removed: 20 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('ingested', 1);
    expect(body).toHaveProperty('contributor_ids');
  });

  it('reuses existing contributor when email matches', async () => {
    // findOrCreateContributor: select finds existing contributor
    mockSelect(
      [{ id: 42 }],    // findOrCreateContributor: SELECT (found)
      [{ repoCount: 1, totalCommits: 10, totalLocAdded: 200, totalLocRemoved: 50, firstSeen: null, lastSeen: null }],
      [{ scoreSecurity: null, scoreQuality: null, scorePatterns: null, scoreTesting: null, scoreInnovation: null }], // recomputeScores: avg scores
    );
    mockInsert([]);     // upsert repo stats
    mockUpdate([]);     // recomputeScores: update

    const res = await app.inject({
      method: 'POST',
      url: '/contributors/ingest',
      payload: {
        repo_name: 'test-repo',
        workspace_id: 1,
        contributors: [
          { email: 'existing@test.com', name: 'Existing', commits: 10, loc_added: 200, loc_removed: 50 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ingested).toBe(1);
    expect(body.contributor_ids['existing@test.com']).toBe(42);
  });

  it('normalizes email to lowercase during ingest', async () => {
    // findOrCreateContributor with uppercase email should query with lowercase
    mockSelect(
      [],  // findOrCreateContributor: SELECT (not found — will create)
      [{ repoCount: 1, totalCommits: 3, totalLocAdded: 50, totalLocRemoved: 10, firstSeen: null, lastSeen: null }],
      [{ scoreSecurity: null, scoreQuality: null, scorePatterns: null, scoreTesting: null, scoreInnovation: null }],
    );
    const insertChains = mockInsert(
      [{ id: 20 }],  // findOrCreateContributor: INSERT
      [],             // upsert repo stats
    );
    mockUpdate([]);

    const res = await app.inject({
      method: 'POST',
      url: '/contributors/ingest',
      payload: {
        repo_name: 'test-repo',
        workspace_id: 1,
        contributors: [
          { email: 'Alice@Test.COM', name: 'Alice', commits: 3, loc_added: 50, loc_removed: 10 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    // The contributor should be stored with lowercase email
    const createChain = insertChains[0];
    const valuesArg = createChain.values.mock.calls[0][0];
    expect(valuesArg.emails).toEqual(['alice@test.com']);
  });
});

// ── POST /contributors/merge ───────────────────────────────────

describe('POST /contributors/merge', () => {
  it('returns 404 when source contributor not found', async () => {
    // source SELECT (not found), target SELECT (found)
    mockSelect(
      [],                                                       // source
      [{ id: 2, emails: ['b@test.com'], displayName: 'Bob' }], // target
    );

    const res = await app.inject({
      method: 'POST',
      url: '/contributors/merge',
      payload: { source_id: 999, target_id: 2 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Contributor not found' });
  });

  it('returns 404 when target contributor not found', async () => {
    mockSelect(
      [{ id: 1, emails: ['a@test.com'], displayName: 'Alice' }], // source
      [],                                                          // target (not found)
    );

    const res = await app.inject({
      method: 'POST',
      url: '/contributors/merge',
      payload: { source_id: 1, target_id: 999 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Contributor not found' });
  });

  it('returns 400 when source and target are in different workspaces', async () => {
    mockSelect(
      [{ id: 1, emails: ['a@test.com'], displayName: 'Alice', workspaceId: 1 }],
      [{ id: 2, emails: ['b@test.com'], displayName: 'Bob', workspaceId: 2 }],
    );

    const res = await app.inject({
      method: 'POST',
      url: '/contributors/merge',
      payload: { source_id: 1, target_id: 2 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Contributors must be in the same workspace' });
  });

  it('merges contributors successfully', async () => {
    const mergedContrib = { id: 2, displayName: 'Bob', emails: ['b@test.com', 'a@test.com'], scoreOverall: 7.5 };

    mockSelect(
      // source + target lookups
      [{ id: 1, emails: ['a@test.com'], displayName: 'Alice', workspaceId: 1 }],   // source
      [{ id: 2, emails: ['b@test.com'], displayName: 'Bob', workspaceId: 1 }],     // target
      // source repo stats
      [{ repoName: 'repo-a' }],
      // target repo stats
      [{ repoName: 'repo-b' }],
      // source daily activity (now includes repoName)
      [],
      // recomputeScores: stats aggregate
      [{ repoCount: 2, totalCommits: 15, totalLocAdded: 300, totalLocRemoved: 100, firstSeen: null, lastSeen: null }],
      // recomputeScores: avg scores
      [{ scoreSecurity: null, scoreQuality: null, scorePatterns: null, scoreTesting: null, scoreInnovation: null }],
      // final merged contributor
      [mergedContrib],
    );

    // update emails, update repo stats (move remaining), findings reassignment, update assessments, recompute update
    mockUpdate([], [], [], [], []);
    // delete source duplicate repos (none in this case), delete daily activity, delete source contributor
    mockDelete([], []);
    // daily activity inserts (none since sourceActivity is [])
    mockInsert();

    const res = await app.inject({
      method: 'POST',
      url: '/contributors/merge',
      payload: { source_id: 1, target_id: 2 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(mergedContrib);
  });
});
