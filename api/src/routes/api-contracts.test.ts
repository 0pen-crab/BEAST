/**
 * API Contract Tests
 *
 * These tests verify the exact shape / property names of API responses.
 * They exist to catch serialization issues such as camelCase vs snake_case
 * mismatches between the Drizzle schema and the JSON the client receives.
 *
 * Each test mocks the underlying data layer to return realistic rows and
 * then asserts that the HTTP response body uses the correct key names.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

// Mock auth middleware so route guards are no-ops in unit tests
vi.mock('../middleware/auth.ts', () => ({
  requireRole: () => async () => {},
}));

import { db } from '../db/index.ts';

// ── Mock entity functions used by auth & engagement-reports routes ──
vi.mock('../orchestrator/entities.ts', () => ({
  findUserByUsername: vi.fn(),
  createUser: vi.fn(),
  countUsers: vi.fn(),
  createSession: vi.fn(),
  findSessionByToken: vi.fn(),
  deleteSession: vi.fn(),
  getScanFiles: vi.fn(),
  initDefaultTools: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

import {
  findUserByUsername,
  createUser,
  countUsers,
  createSession,
  getScanFiles,
} from '../orchestrator/entities.ts';
import bcrypt from 'bcrypt';

const mockFindUser = findUserByUsername as ReturnType<typeof vi.fn>;
const mockCreateUser = createUser as ReturnType<typeof vi.fn>;
const mockCountUsers = countUsers as ReturnType<typeof vi.fn>;
const mockCreateSession = createSession as ReturnType<typeof vi.fn>;
const mockCompare = bcrypt.compare as ReturnType<typeof vi.fn>;
const mockHash = bcrypt.hash as ReturnType<typeof vi.fn>;
const mockGetScanFiles = getScanFiles as ReturnType<typeof vi.fn>;
const mockDb = db as any;

// ── Helpers ─────────────────────────────────────────────────────────

/** Assert that `obj` has every key in `expected` and none of `forbidden`. */
function assertShape(obj: Record<string, unknown>, expected: string[], forbidden: string[]) {
  for (const key of expected) {
    expect(obj).toHaveProperty(key);
  }
  for (const key of forbidden) {
    expect(obj).not.toHaveProperty(key);
  }
}

// ── App setup ───────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Simulate authenticated super_admin user for routes that read request.user
  app.addHook('onRequest', async (request) => {
    request.user = { id: 1, username: 'admin', role: 'super_admin', displayName: 'Admin', mustChangePassword: false };
  });

  const { authRoutes } = await import('./auth.ts');
  const { workspaceDataRoutes } = await import('./workspace-data.ts');
  const { workspaceRoutes } = await import('./workspaces.ts');
  const { engagementReportRoutes } = await import('./engagement-reports.ts');

  await app.register(authRoutes);
  await app.register(workspaceDataRoutes);
  await app.register(workspaceRoutes);
  await app.register(engagementReportRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset chainable db mock
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
// 1. POST /auth/login — response shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: POST /auth/login', () => {
  it('response has { token, user: { id, username, displayName, role } } (camelCase)', async () => {
    mockFindUser.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      passwordHash: 'hashed',
      displayName: 'Admin User',
      role: 'admin',
    });
    mockCompare.mockResolvedValueOnce(true);
    mockCreateSession.mockResolvedValueOnce({ token: 'tok-123' });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'pass123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Top-level keys
    expect(body).toHaveProperty('token');
    expect(body).toHaveProperty('user');

    // User object must use camelCase
    assertShape(body.user, ['id', 'username', 'displayName', 'role'], [
      'display_name',
      'password_hash',
      'passwordHash',
      'created_at',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. GET /findings/counts — response shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: GET /findings/counts', () => {
  it('response has PascalCase severities and camelCase riskAccepted', async () => {
    const countsRow = {
      Critical: 2,
      High: 5,
      Medium: 10,
      Low: 3,
      Info: 1,
      total: 21,
      riskAccepted: 4,
    };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([countsRow]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings/counts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    assertShape(body, ['Critical', 'High', 'Medium', 'Low', 'Info', 'total', 'riskAccepted'], [
      'critical',
      'high',
      'medium',
      'low',
      'info',
      'risk_accepted',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. GET /findings — results items shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: GET /findings', () => {
  it('result items use camelCase keys from Drizzle schema', async () => {
    const now = new Date().toISOString();
    const finding = {
      id: 1,
      testId: 10,
      repositoryId: 5,
      title: 'SQL Injection',
      severity: 'High',
      description: 'Found SQLi',
      filePath: 'src/db.ts',
      line: 42,
      vulnIdFromTool: 'CWE-89',
      cwe: 89,
      cvssScore: 8.5,
      tool: 'beast',
      status: 'open',
      riskAcceptedReason: null,
      fingerprint: 'abc123',
      duplicateOf: null,
      createdAt: now,
      updatedAt: now,
    };

    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // count query
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          }),
        };
      }
      // data query
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([finding]),
              }),
            }),
          }),
        }),
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/findings',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('count');
    expect(body).toHaveProperty('results');
    expect(body.results).toHaveLength(1);

    const item = body.results[0];
    assertShape(
      item,
      [
        'id',
        'testId',
        'repositoryId',
        'title',
        'severity',
        'filePath',
        'vulnIdFromTool',
        'cvssScore',
        'riskAcceptedReason',
        'duplicateOf',
        'createdAt',
        'updatedAt',
      ],
      [
        'test_id',
        'repository_id',
        'file_path',
        'vuln_id_from_tool',
        'cvss_score',
        'risk_accepted',
        'risk_accepted_reason',
        'duplicate_of',
        'created_at',
        'updated_at',
      ],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. GET /workspaces — items shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: GET /workspaces', () => {
  it('workspace items have camelCase defaultLanguage and createdAt', async () => {
    const workspace = {
      id: 1,
      name: 'Default',
      description: null,
      defaultLanguage: 'en',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([workspace]),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);

    assertShape(body[0], ['id', 'name', 'defaultLanguage', 'createdAt'], [
      'default_language',
      'created_at',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. GET /tests — items shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: GET /tests', () => {
  it('test items use camelCase keys from Drizzle schema', async () => {
    const testRow = {
      id: 1,
      scanId: 'scan-uuid-1',
      tool: 'gitleaks',
      scanType: 'Static Analysis',
      testTitle: 'Gitleaks Scan',
      fileName: 'results.sarif',
      findingsCount: 12,
      importStatus: 'completed',
      createdAt: '2026-01-15T10:00:00.000Z',
    };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([testRow]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tests',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);

    assertShape(
      body[0],
      ['id', 'scanId', 'scanType', 'testTitle', 'fileName', 'findingsCount', 'importStatus', 'createdAt'],
      ['scan_id', 'scan_type', 'test_title', 'file_name', 'findings_count', 'import_status', 'created_at'],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. GET /repositories — items shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: GET /repositories', () => {
  it('repository items use camelCase keys', async () => {
    const repo = {
      id: 1,
      teamId: 3,
      name: 'beast-api',
      repoUrl: 'https://github.com/org/beast-api',
      description: 'Main API',
      lifecycle: 'active',
      tags: ['security'],
      status: 'pending',
      externalId: 'gh-12345',
      sourceId: 2,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-15T00:00:00.000Z',
      teamName: 'Platform',
      workspaceId: 1,
      findingsCount: 7,
    };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([repo]),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/repositories',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);

    assertShape(
      body[0],
      [
        'id',
        'teamId',
        'repoUrl',
        'teamName',
        'findingsCount',
        'externalId',
        'sourceId',
        'createdAt',
        'updatedAt',
      ],
      [
        'team_id',
        'repo_url',
        'team_name',
        'findings_count',
        'external_id',
        'source_id',
        'created_at',
        'updated_at',
      ],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. GET /scan-reports/:scanId — report objects shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: GET /scan-reports/:scanId', () => {
  it('report objects have content and updatedAt (camelCase), not created_at/file_type', async () => {
    mockGetScanFiles.mockResolvedValueOnce([
      {
        id: 1,
        scanId: 'scan-uuid-1',
        fileName: 'profile.md',
        fileType: 'profile',
        filePath: null,
        content: '# Security Profile',
        createdAt: new Date('2026-03-01T12:00:00Z'),
      },
      {
        id: 2,
        scanId: 'scan-uuid-1',
        fileName: 'audit.md',
        fileType: 'audit',
        filePath: null,
        content: '# Audit Report',
        createdAt: new Date('2026-03-01T12:30:00Z'),
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/scan-reports/scan-uuid-1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Both report types present
    expect(body).toHaveProperty('profile');
    expect(body).toHaveProperty('audit');

    // Each report object shape
    for (const key of ['profile', 'audit']) {
      assertShape(body[key], ['content', 'updatedAt'], [
        'created_at',
        'file_type',
        'fileType',
        'updated_at',
      ]);
    }

    // Verify updatedAt is an ISO string, not a raw Date object
    expect(typeof body.profile.updatedAt).toBe('string');
    expect(body.profile.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. POST /auth/register — REMOVED (register endpoint deleted)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// 9. GET /findings/:id — single finding shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: GET /findings/:id', () => {
  it('single finding uses camelCase keys', async () => {
    const now = new Date().toISOString();
    const finding = {
      id: 42,
      testId: 10,
      repositoryId: 5,
      title: 'Hardcoded Secret',
      severity: 'Critical',
      description: 'AWS key exposed',
      filePath: 'config/aws.ts',
      line: 7,
      vulnIdFromTool: 'gitleaks-aws-key',
      cwe: null,
      cvssScore: 9.0,
      tool: 'gitleaks',
      status: 'open',
      riskAcceptedReason: null,
      fingerprint: 'fp-xyz',
      duplicateOf: null,
      createdAt: now,
      updatedAt: now,
      contributorId: 3,
      contributorName: 'Dev User',
      repositoryName: 'my-repo',
      scanId: 'scan-abc-123',
      workspaceId: 1,
    };
    // Chain: select -> from -> innerJoin -> innerJoin -> leftJoin -> leftJoin -> where
    const chainable = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([finding]),
    };
    mockDb.select.mockReturnValue(chainable);

    const res = await app.inject({
      method: 'GET',
      url: '/findings/42',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    assertShape(
      body,
      [
        'id',
        'testId',
        'repositoryId',
        'filePath',
        'vulnIdFromTool',
        'cvssScore',
        'riskAcceptedReason',
        'duplicateOf',
        'createdAt',
        'updatedAt',
        'repositoryName',
        'scanId',
        'contributorName',
        'workspaceId',
      ],
      [
        'test_id',
        'repository_id',
        'file_path',
        'vuln_id_from_tool',
        'cvss_score',
        'risk_accepted',
        'risk_accepted_reason',
        'duplicate_of',
        'created_at',
        'updated_at',
        'repository_name',
        'scan_id',
        'contributor_name',
        'workspace_id',
      ],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. POST /workspaces — created workspace shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: POST /workspaces', () => {
  it('created workspace uses camelCase defaultLanguage and createdAt', async () => {
    const created = {
      id: 1,
      name: 'Prod',
      description: null,
      defaultLanguage: 'uk',
      createdAt: '2026-03-09T00:00:00.000Z',
    };
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([created]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'Prod', default_language: 'uk' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    assertShape(body, ['id', 'name', 'defaultLanguage', 'createdAt'], [
      'default_language',
      'created_at',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. GET /tests (by scan_id) — same shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: GET /tests?scan_id=X', () => {
  it('test items returned by scan_id filter use camelCase', async () => {
    const testRow = {
      id: 5,
      scanId: 'scan-abc',
      tool: 'trivy',
      scanType: 'Container',
      testTitle: 'Trivy Container Scan',
      fileName: 'trivy-results.json',
      findingsCount: 3,
      importStatus: 'completed',
      createdAt: '2026-02-20T08:00:00.000Z',
    };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([testRow]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tests?scan_id=scan-abc',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);

    assertShape(
      body[0],
      ['scanId', 'scanType', 'testTitle', 'fileName', 'findingsCount', 'importStatus', 'createdAt'],
      ['scan_id', 'scan_type', 'test_title', 'file_name', 'findings_count', 'import_status', 'created_at'],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. PATCH /findings/:id — updated finding shape
// ═══════════════════════════════════════════════════════════════════

describe('Contract: PATCH /findings/:id', () => {
  it('updated finding uses camelCase keys', async () => {
    const now = new Date().toISOString();
    const updated = {
      id: 1,
      testId: 10,
      repositoryId: 5,
      title: 'SQL Injection',
      severity: 'High',
      description: 'Found SQLi',
      filePath: 'src/db.ts',
      line: 42,
      vulnIdFromTool: 'CWE-89',
      cwe: 89,
      cvssScore: 8.5,
      tool: 'beast',
      status: 'risk_accepted',
      riskAcceptedReason: 'Accepted by team lead',
      fingerprint: 'abc123',
      duplicateOf: null,
      createdAt: now,
      updatedAt: now,
    };
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/findings/1',
      payload: { status: 'risk_accepted' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    assertShape(
      body,
      ['riskAcceptedReason', 'createdAt', 'updatedAt', 'vulnIdFromTool', 'cvssScore'],
      ['risk_accepted', 'risk_accepted_reason', 'created_at', 'updated_at', 'vuln_id_from_tool', 'cvss_score'],
    );
  });
});
