import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// ── Mocks ────────────────────────────────────────────────────

vi.mock('../middleware/auth.ts', () => ({
  authHook: async () => {},
  registerSafetyNet: () => {},
}));

vi.mock('../lib/authorize.ts', () => ({
  authorize: async (req: any) => { req.authorized = true; },
  ForbiddenError: class extends Error { statusCode = 403; },
}));

const mockDbSelect = vi.fn();
vi.mock('../db/index.ts', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock('../db/schema.ts', () => ({
  findings: { id: 'f.id', testId: 'f.test_id', repositoryId: 'f.repo_id', title: 'f.title', severity: 'f.severity', tool: 'f.tool', status: 'f.status', description: 'f.desc', filePath: 'f.file', line: 'f.line', cwe: 'f.cwe', cvssScore: 'f.cvss', codeSnippet: 'f.code', createdAt: 'f.created' },
  tests: { id: 't.id', scanId: 't.scan_id' },
  scans: { id: 's.id', workspaceId: 's.ws_id' },
  repositories: { id: 'r.id', name: 'r.name' },
  workspaces: { defaultLanguage: 'w.lang' },
}));

vi.mock('../orchestrator/ssh.ts', () => ({
  sshExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
  sshWriteFile: vi.fn().mockResolvedValue(undefined),
  sshReadFile: vi.fn().mockResolvedValue('ID,Repository,Title,Severity,Tool,Status,File,Line,CWE,CVSS,Description,Created\n1,repo-a,XSS,High,beast,open,app.ts,10,,,desc,2026-01-01\n'),
  getClaudeRunnerConfig: vi.fn().mockReturnValue({ host: 'test', port: 22, username: 'test', privateKey: Buffer.from('') }),
  parseStreamJsonResult: vi.fn().mockReturnValue({ result: { is_error: false }, log: '' }),
  SSHTimeoutError: class extends Error { stdout = ''; stderr = ''; },
}));

vi.mock('../orchestrator/prompt-languages.ts', () => ({
  getLanguageInstruction: vi.fn().mockReturnValue(''),
}));

import { highlightsRoutes } from './highlights.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRequest', async (req) => {
    req.authorized = false;
    req.user = { id: 1, username: 'admin', role: 'super_admin', displayName: 'Admin', mustChangePassword: false };
  });
  await app.register(highlightsRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────

function mockChainableQuery(result: unknown[]) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.leftJoin = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(result);
  return chain;
}

// ── Tests ────────────────────────────────────────────────────

describe('highlightsRoutes plugin', () => {
  it('registers without error', () => {
    expect(app).toBeDefined();
  });
});

describe('POST /highlights/generate', () => {
  it('returns no_findings error when workspace has no open findings', async () => {
    // First call: workspace language query
    const wsChain = mockChainableQuery([{ defaultLanguage: 'en' }]);
    // Second call: findings query (empty)
    const findingsChain = mockChainableQuery([]);

    let callCount = 0;
    mockDbSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return wsChain;
      return findingsChain;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/highlights/generate?workspace_id=1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error).toBe('no_findings');
  });

  it('returns jobId when findings exist', async () => {
    const wsChain = mockChainableQuery([{ defaultLanguage: 'en' }]);
    const findingsChain = mockChainableQuery([
      { id: 1, repositoryName: 'repo-a', title: 'XSS', severity: 'High', tool: 'beast', status: 'open', description: 'desc', filePath: 'app.ts', line: 10, cwe: null, cvssScore: null, codeSnippet: null, createdAt: new Date() },
    ]);

    let callCount = 0;
    mockDbSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return wsChain;
      return findingsChain;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/highlights/generate?workspace_id=1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobId).toBeDefined();
    expect(body.findingsCount).toBe(1);
  });

  it('requires workspace_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/highlights/generate',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /highlights/:id', () => {
  it('returns 404 for unknown job', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/highlights/00000000-0000-0000-0000-000000000000?workspace_id=1',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /highlights/:id/download', () => {
  it('returns 404 for unknown job', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/highlights/00000000-0000-0000-0000-000000000000/download?workspace_id=1',
    });

    expect(res.statusCode).toBe(404);
  });
});
