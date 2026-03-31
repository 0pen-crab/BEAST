import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authRoutes } from './auth.ts';

// Mock entity functions
vi.mock('../orchestrator/entities.ts', () => ({
  findUserByUsername: vi.fn(),
  createSession: vi.fn(),
  findSessionByToken: vi.fn(),
  deleteSession: vi.fn(),
  getWorkspaceMember: vi.fn(),
  updateUser: vi.fn(),
  findUserById: vi.fn(),
  countUsers: vi.fn(),
  createUser: vi.fn(),
}));

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

import {
  findUserByUsername,
  createSession,
  findSessionByToken,
  deleteSession,
  updateUser,
  findUserById,
} from '../orchestrator/entities.ts';
import bcrypt from 'bcrypt';

const mockFindUser = findUserByUsername as ReturnType<typeof vi.fn>;
const mockCreateSession = createSession as ReturnType<typeof vi.fn>;
const mockFindSession = findSessionByToken as ReturnType<typeof vi.fn>;
const mockDeleteSession = deleteSession as ReturnType<typeof vi.fn>;
const mockCompare = bcrypt.compare as ReturnType<typeof vi.fn>;
const mockHash = bcrypt.hash as ReturnType<typeof vi.fn>;
const mockUpdateUser = updateUser as ReturnType<typeof vi.fn>;
const mockFindUserById = findUserById as ReturnType<typeof vi.fn>;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register auth hook so /auth/me works via request.user
  const { authHook } = await import('../middleware/auth.ts');
  app.addHook('onRequest', authHook);

  await app.register(authRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── POST /auth/login ──────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns 200 with token and user on valid credentials', async () => {
    const user = {
      id: 1,
      username: 'admin',
      passwordHash: 'hashed',
      displayName: 'Admin',
      role: 'admin',
      mustChangePassword: false,
    };
    mockFindUser.mockResolvedValueOnce(user);
    mockCompare.mockResolvedValueOnce(true);
    mockCreateSession.mockResolvedValueOnce({ token: 'session-token-123' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'pass123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBe('session-token-123');
    expect(body.user).toEqual({
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      mustChangePassword: false,
    });
  });

  it('calls findUserByUsername with the provided username', async () => {
    mockFindUser.mockResolvedValueOnce(null);

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'pass123' },
    });

    expect(mockFindUser).toHaveBeenCalledWith('testuser');
  });

  it('calls bcrypt.compare with the correct arguments', async () => {
    const user = {
      id: 1,
      username: 'admin',
      passwordHash: 'stored-hash',
      displayName: 'Admin',
      role: 'admin',
    };
    mockFindUser.mockResolvedValueOnce(user);
    mockCompare.mockResolvedValueOnce(true);
    mockCreateSession.mockResolvedValueOnce({ token: 'tok' });

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'mypassword' },
    });

    expect(mockCompare).toHaveBeenCalledWith('mypassword', 'stored-hash');
  });

  it('calls createSession with the user id on successful login', async () => {
    const user = {
      id: 42,
      username: 'admin',
      passwordHash: 'hashed',
      displayName: 'Admin',
      role: 'admin',
    };
    mockFindUser.mockResolvedValueOnce(user);
    mockCompare.mockResolvedValueOnce(true);
    mockCreateSession.mockResolvedValueOnce({ token: 'tok' });

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'pass' },
    });

    expect(mockCreateSession).toHaveBeenCalledWith(42);
  });

  it('returns 401 for unknown user', async () => {
    mockFindUser.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'pass' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid credentials');
  });

  it('does not call bcrypt.compare when user is not found', async () => {
    mockFindUser.mockResolvedValueOnce(null);

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'pass' },
    });

    expect(mockCompare).not.toHaveBeenCalled();
  });

  it('returns 401 for wrong password', async () => {
    mockFindUser.mockResolvedValueOnce({ id: 1, passwordHash: 'hash' });
    mockCompare.mockResolvedValueOnce(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid credentials');
  });

  it('does not create session when password is wrong', async () => {
    mockFindUser.mockResolvedValueOnce({ id: 1, passwordHash: 'hash' });
    mockCompare.mockResolvedValueOnce(false);

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });

    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns 400 when username is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: '', password: 'pass123' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when password is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when both fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('includes mustChangePassword:false for normal user', async () => {
    const user = {
      id: 1,
      username: 'admin',
      passwordHash: 'hashed',
      displayName: 'Admin',
      role: 'admin',
      mustChangePassword: false,
    };
    mockFindUser.mockResolvedValueOnce(user);
    mockCompare.mockResolvedValueOnce(true);
    mockCreateSession.mockResolvedValueOnce({ token: 'tok' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'pass' },
    });

    expect(res.json().user.mustChangePassword).toBe(false);
  });

  it('includes mustChangePassword:true for temp-password user', async () => {
    const user = {
      id: 1,
      username: 'newguy',
      passwordHash: 'hashed',
      displayName: 'New',
      role: 'user',
      mustChangePassword: true,
    };
    mockFindUser.mockResolvedValueOnce(user);
    mockCompare.mockResolvedValueOnce(true);
    mockCreateSession.mockResolvedValueOnce({ token: 'tok' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'newguy', password: 'temppass' },
    });

    expect(res.json().user.mustChangePassword).toBe(true);
  });
});

// ── POST /auth/logout ─────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('deletes session with Token prefix and returns 204', async () => {
    mockDeleteSession.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: 'Token mytoken123' },
    });

    expect(res.statusCode).toBe(204);
    expect(mockDeleteSession).toHaveBeenCalledWith('mytoken123');
  });

  it('returns 204 even without authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(res.statusCode).toBe(204);
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it('handles Bearer prefix', async () => {
    mockDeleteSession.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: 'Bearer mytoken' },
    });

    expect(res.statusCode).toBe(204);
    expect(mockDeleteSession).toHaveBeenCalledWith('mytoken');
  });

  it('handles raw token without prefix', async () => {
    mockDeleteSession.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: 'rawtoken123' },
    });

    expect(res.statusCode).toBe(204);
    expect(mockDeleteSession).toHaveBeenCalledWith('rawtoken123');
  });
});

// ── GET /auth/me ──────────────────────────────────────────────

describe('GET /auth/me', () => {
  it('returns user info for valid token', async () => {
    mockFindSession.mockResolvedValueOnce({
      userId: 1,
      username: 'admin',
      role: 'super_admin',
      displayName: 'Admin User',
      mustChangePassword: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Token validtoken' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 1,
      username: 'admin',
      displayName: 'Admin User',
      role: 'super_admin',
      mustChangePassword: false,
    });
  });

  it('returns user info with Bearer prefix', async () => {
    mockFindSession.mockResolvedValueOnce({
      userId: 2,
      username: 'user1',
      role: 'user',
      displayName: null,
      mustChangePassword: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer bearertoken' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 2,
      username: 'user1',
      displayName: null,
      role: 'user',
      mustChangePassword: false,
    });
  });

  it('returns 401 when no authorization header is present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Unauthorized');
  });

  it('returns 401 for invalid/expired token', async () => {
    mockFindSession.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Token expired' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Unauthorized');
  });

  it('does not include password_hash in response', async () => {
    mockFindSession.mockResolvedValueOnce({
      userId: 1,
      username: 'admin',
      role: 'super_admin',
      displayName: 'Admin',
      mustChangePassword: false,
      passwordHash: 'should-not-appear',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Token validtoken' },
    });

    const body = res.json();
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('includes mustChangePassword in response', async () => {
    mockFindSession.mockResolvedValueOnce({
      userId: 1,
      username: 'admin',
      role: 'super_admin',
      displayName: 'Admin',
      mustChangePassword: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Token validtoken' },
    });

    expect(res.json().mustChangePassword).toBe(true);
  });
});

// ── PATCH /auth/password ─────────────────────────────────────

describe('PATCH /auth/password', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      payload: { newPassword: 'newpass123' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when newPassword is too short', async () => {
    mockFindSession.mockResolvedValueOnce({
      userId: 1,
      username: 'admin',
      role: 'user',
      displayName: null,
      mustChangePassword: true,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { authorization: 'Token validtoken' },
      payload: { newPassword: 'short' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('updates password and clears mustChangePassword on success', async () => {
    mockFindSession.mockResolvedValueOnce({
      userId: 1,
      username: 'admin',
      role: 'user',
      displayName: null,
      mustChangePassword: true,
    });
    mockHash.mockResolvedValueOnce('new-hashed');
    mockUpdateUser.mockResolvedValueOnce({ id: 1 });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { authorization: 'Token validtoken' },
      payload: { newPassword: 'newpass123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockUpdateUser).toHaveBeenCalledWith(1, {
      passwordHash: 'new-hashed',
      mustChangePassword: false,
    });
  });
});
