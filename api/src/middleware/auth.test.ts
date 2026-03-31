import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock entities
vi.mock('../orchestrator/entities.ts', () => ({
  findSessionByToken: vi.fn(),
  getWorkspaceMember: vi.fn(),
}));

import { findSessionByToken, getWorkspaceMember } from '../orchestrator/entities.ts';
const mockFindSession = vi.mocked(findSessionByToken);
const mockGetMember = vi.mocked(getWorkspaceMember);

// Import after mocks
const { authHook } = await import('./auth.ts');

function mockRequest(overrides: Record<string, any> = {}) {
  return {
    url: '/api/teams',
    method: 'GET',
    headers: {},
    query: {},
    params: {},
    body: null,
    user: undefined,
    ...overrides,
  } as any;
}

function mockReply() {
  const reply: any = { statusCode: 200 };
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply;
}

describe('authHook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips health endpoint', async () => {
    const req = mockRequest({ url: '/api/health' });
    const rep = mockReply();
    await authHook(req, rep);
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it('skips login endpoint', async () => {
    const req = mockRequest({ url: '/api/auth/login', method: 'POST' });
    const rep = mockReply();
    await authHook(req, rep);
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it('skips webhook endpoints', async () => {
    const req = mockRequest({ url: '/api/webhooks/bitbucket', method: 'POST' });
    const rep = mockReply();
    await authHook(req, rep);
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it('returns 401 when no token', async () => {
    const req = mockRequest();
    const rep = mockReply();
    await authHook(req, rep);
    expect(rep.status).toHaveBeenCalledWith(401);
    expect(rep.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 401 when token is invalid', async () => {
    mockFindSession.mockResolvedValue(null);
    const req = mockRequest({ headers: { authorization: 'Token bad' } });
    const rep = mockReply();
    await authHook(req, rep);
    expect(rep.status).toHaveBeenCalledWith(401);
  });

  it('attaches user to request on valid token', async () => {
    mockFindSession.mockResolvedValue({
      id: 1, userId: 5, token: 'abc', createdAt: new Date(), expiresAt: new Date(),
      username: 'admin', role: 'super_admin', displayName: 'Admin',
    } as any);
    const req = mockRequest({ headers: { authorization: 'Token abc' } });
    const rep = mockReply();
    await authHook(req, rep);
    expect(req.user).toEqual({ id: 5, username: 'admin', role: 'super_admin', displayName: 'Admin', mustChangePassword: false });
  });
});

// Note: requireRole was removed. Authorization is now handled by authorize() in handlers.
// Tests for authorize() are in lib/authorize.test.ts
