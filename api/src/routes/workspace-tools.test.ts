import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

// Mock auth middleware
vi.mock('../middleware/auth.ts', () => ({
  requireRole: () => async () => {},
}));

// Mock vault
vi.mock('../lib/vault.ts', () => ({
  getSecret: vi.fn().mockResolvedValue(null),
  setSecret: vi.fn().mockResolvedValue({ id: 1 }),
}));

// Mock entities
vi.mock('../orchestrator/entities.ts', () => ({
  getWorkspaceTools: vi.fn().mockResolvedValue([]),
  setWorkspaceTools: vi.fn().mockResolvedValue(undefined),
}));

// Mock tool validators
vi.mock('../lib/tool-validators.ts', () => ({
  getValidator: vi.fn(),
}));

import { getSecret, setSecret } from '../lib/vault.ts';
import { getWorkspaceTools, setWorkspaceTools } from '../orchestrator/entities.ts';
import { getValidator } from '../lib/tool-validators.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRequest', async (request) => {
    request.user = { id: 1, username: 'admin', role: 'super_admin', displayName: 'Admin', mustChangePassword: false };
  });
  const mod = await import('./workspace-tools.ts');
  await app.register(mod.workspaceToolRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.mocked(getWorkspaceTools).mockReset().mockResolvedValue([]);
  vi.mocked(setWorkspaceTools).mockReset().mockResolvedValue(undefined);
  vi.mocked(getSecret).mockReset().mockResolvedValue(null);
  vi.mocked(setSecret).mockReset().mockResolvedValue({ id: 1 } as any);
  vi.mocked(getValidator).mockReset();
});

describe('GET /tools/registry', () => {
  it('returns tool registry array', async () => {
    const res = await app.inject({ method: 'GET', url: '/tools/registry' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(16);
    expect(body[0]).toHaveProperty('key');
    expect(body[0]).toHaveProperty('displayName');
  });
});

describe('GET /workspaces/:id/tools', () => {
  it('returns tool selections with has_credentials flag', async () => {
    vi.mocked(getWorkspaceTools).mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'gitguardian', enabled: true },
    ]);

    const res = await app.inject({ method: 'GET', url: '/workspaces/1/tools' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({ tool_key: 'gitleaks', enabled: true, has_credentials: true });
  });

  it('returns has_credentials false when secret missing', async () => {
    vi.mocked(getWorkspaceTools).mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    vi.mocked(getSecret).mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: '/workspaces/1/tools' });
    const body = res.json();
    expect(body[0].has_credentials).toBe(false);
  });

  it('returns has_credentials true when all secrets present', async () => {
    vi.mocked(getWorkspaceTools).mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    vi.mocked(getSecret).mockResolvedValue('some-api-key');

    const res = await app.inject({ method: 'GET', url: '/workspaces/1/tools' });
    const body = res.json();
    expect(body[0].has_credentials).toBe(true);
  });

  it('returns empty array when no tools configured', async () => {
    vi.mocked(getWorkspaceTools).mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/workspaces/1/tools' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('PUT /workspaces/:id/tools', () => {
  it('updates selections and returns ok', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1/tools',
      payload: {
        tools: [
          { tool_key: 'gitleaks', enabled: true },
          { tool_key: 'trivy-secrets', enabled: false },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(setWorkspaceTools).toHaveBeenCalledWith(1, [
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'trivy-secrets', enabled: false },
    ]);
  });

  it('returns 400 for invalid tool_key', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1/tools',
      payload: {
        tools: [{ tool_key: 'nonexistent-tool', enabled: true }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid tool key');
  });

  it('saves credentials to vault when provided', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1/tools',
      payload: {
        tools: [{
          tool_key: 'gitguardian',
          enabled: true,
          credentials: { GITGUARDIAN_API_KEY: 'my-secret-key' },
        }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(setSecret).toHaveBeenCalled();
  });

  it('does not call setSecret when no credentials provided', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/workspaces/1/tools',
      payload: {
        tools: [{ tool_key: 'gitleaks', enabled: true }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(setSecret).not.toHaveBeenCalled();
  });
});

describe('POST /api/workspaces/:id/tools/validate', () => {
  it('returns valid:true and saves to vault on successful validation', async () => {
    vi.mocked(getValidator).mockReturnValue(vi.fn().mockResolvedValue({ valid: true }));

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces/1/tools/validate',
      payload: {
        tool_key: 'gitguardian',
        credentials: { GITGUARDIAN_API_KEY: 'valid-key' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true });
    expect(setSecret).toHaveBeenCalled();
  });

  it('returns valid:false and does NOT save on failed validation', async () => {
    vi.mocked(getValidator).mockReturnValue(
      vi.fn().mockResolvedValue({ valid: false, error: 'Invalid API key' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces/1/tools/validate',
      payload: {
        tool_key: 'gitguardian',
        credentials: { GITGUARDIAN_API_KEY: 'bad-key' },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ valid: false, error: 'Invalid API key' });
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('returns 400 for unknown tool_key', async () => {
    vi.mocked(getValidator).mockReturnValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/workspaces/1/tools/validate',
      payload: {
        tool_key: 'nonexistent',
        credentials: {},
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No validator for tool: nonexistent' });
  });
});
