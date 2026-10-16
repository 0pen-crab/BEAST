import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

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

// Mock entities used by engagement-reports routes
vi.mock('../orchestrator/entities.ts', () => ({
  getScanFiles: vi.fn(),
}));

import { engagementReportRoutes } from './engagement-reports.ts';
import { getScanFiles } from '../orchestrator/entities.ts';
import { db } from '../db/index.ts';

const mockGetScanFiles = getScanFiles as ReturnType<typeof vi.fn>;
const mockDb = db as any;

// Valid UUIDs for route params (schema validates z.string().uuid())
const SCAN_UUID = '00000000-0000-4000-8000-000000000001';
const SCAN_UUID_EMPTY = '00000000-0000-4000-8000-000000000002';
const SCAN_UUID_FILTER = '00000000-0000-4000-8000-000000000003';

/** Mock db.select() chain to resolve with given rows (for scan lookup) */
function mockDbSelectOnce(rows: any[]) {
  mockDb.select.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('preHandler', async (request) => {
    request.user = { id: 1, username: 'test', role: 'super_admin', displayName: 'Test', mustChangePassword: false };
  });
  await app.register(engagementReportRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Plugin Registration ──────────────────────────────────────

describe('engagementReportRoutes plugin', () => {
  it('registers without error', () => {
    expect(app).toBeDefined();
  });
});

// ── GET /scan-reports/:scanId ────────────────────────────────

describe('GET /scan-reports/:scanId', () => {
  it('returns both profile and audit reports', async () => {
    mockDbSelectOnce([{ workspaceId: 1 }]);
    mockGetScanFiles.mockResolvedValueOnce([
      { fileType: 'profile', content: '# Profile Report', createdAt: new Date('2026-03-01T00:00:00Z') },
      { fileType: 'audit', content: '# Audit Report', createdAt: new Date('2026-03-02T00:00:00Z') },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/scan-reports/${SCAN_UUID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('profile');
    expect(body).toHaveProperty('audit');
    expect(body.profile.content).toBe('# Profile Report');
    expect(body.audit.content).toBe('# Audit Report');
    expect(mockGetScanFiles).toHaveBeenCalledWith(SCAN_UUID);
  });

  it('returns empty object when no reports exist', async () => {
    mockDbSelectOnce([{ workspaceId: 1 }]);
    mockGetScanFiles.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: `/scan-reports/${SCAN_UUID_EMPTY}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('only includes profile and audit types', async () => {
    mockDbSelectOnce([{ workspaceId: 1 }]);
    mockGetScanFiles.mockResolvedValueOnce([
      { fileType: 'profile', content: 'Profile', createdAt: new Date('2026-03-01T00:00:00Z') },
      { fileType: 'sarif', content: 'SARIF data', createdAt: new Date('2026-03-01T00:00:00Z') },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/scan-reports/${SCAN_UUID_FILTER}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('profile');
    expect(body).not.toHaveProperty('sarif');
  });
});

// ── GET /scan-reports/:scanId/:type ──────────────────────────

describe('GET /scan-reports/:scanId/:type', () => {
  it('returns specific report type', async () => {
    mockDbSelectOnce([{ workspaceId: 1 }]);
    mockGetScanFiles.mockResolvedValueOnce([
      { fileType: 'audit', content: '# Audit', createdAt: new Date('2026-03-01T00:00:00Z') },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/scan-reports/${SCAN_UUID}/audit`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe('# Audit');
    expect(body.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('returns 400 for invalid report type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scan-reports/${SCAN_UUID}/invalid`,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when report not found', async () => {
    mockDbSelectOnce([{ workspaceId: 1 }]);
    mockGetScanFiles.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: `/scan-reports/${SCAN_UUID}/profile`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Report not found');
  });
});
