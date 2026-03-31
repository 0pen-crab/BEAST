import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { memberRoutes } from './members.ts';

vi.mock('../orchestrator/entities.ts', () => ({
  findUserByUsername: vi.fn(),
  findUserById: vi.fn(),
  createUser: vi.fn(),
  addWorkspaceMember: vi.fn(),
  getWorkspaceMember: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  countWorkspaceAdmins: vi.fn(),
  findSessionByToken: vi.fn(),
}));

vi.mock('../middleware/auth.ts', () => ({
  authHook: async () => {},
  requireRole: () => async () => {},
}));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn() },
}));

vi.mock('../lib/password.ts', () => ({
  generatePassword: vi.fn(() => 'TempPw12'),
}));

import {
  findUserByUsername,
  createUser,
  addWorkspaceMember,
  getWorkspaceMember,
  listWorkspaceMembers,
  countWorkspaceAdmins,
  removeWorkspaceMember,
} from '../orchestrator/entities.ts';
import bcrypt from 'bcrypt';

const mockFindUser = findUserByUsername as ReturnType<typeof vi.fn>;
const mockCreateUser = createUser as ReturnType<typeof vi.fn>;
const mockAddMember = addWorkspaceMember as ReturnType<typeof vi.fn>;
const mockGetMember = getWorkspaceMember as ReturnType<typeof vi.fn>;
const mockListMembers = listWorkspaceMembers as ReturnType<typeof vi.fn>;
const mockCountAdmins = countWorkspaceAdmins as ReturnType<typeof vi.fn>;
const mockRemoveMember = removeWorkspaceMember as ReturnType<typeof vi.fn>;
const mockHash = bcrypt.hash as ReturnType<typeof vi.fn>;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(memberRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/workspaces/:id/members', () => {
  it('adds existing user to workspace', async () => {
    mockFindUser.mockResolvedValueOnce({ id: 5, username: 'existing@test.com' });
    mockGetMember.mockResolvedValueOnce(null);
    mockAddMember.mockResolvedValueOnce({
      id: 1, userId: 5, workspaceId: 1, role: 'member', createdAt: '2026-01-01',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/1/members',
      payload: { username: 'existing@test.com', role: 'member' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.member.userId).toBe(5);
    expect(body).not.toHaveProperty('generatedPassword');
  });

  it('creates new user when username not found', async () => {
    mockFindUser.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce('hashed-temp');
    mockCreateUser.mockResolvedValueOnce({ id: 10, username: 'new@test.com' });
    mockGetMember.mockResolvedValueOnce(null);
    mockAddMember.mockResolvedValueOnce({
      id: 2, userId: 10, workspaceId: 1, role: 'member', createdAt: '2026-01-01',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/1/members',
      payload: { username: 'new@test.com', role: 'member' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.generatedPassword).toBe('TempPw12');
    expect(mockCreateUser).toHaveBeenCalledWith({
      username: 'new@test.com',
      passwordHash: 'hashed-temp',
      displayName: 'new@test.com',
      role: 'user',
      mustChangePassword: true,
    });
  });

  it('returns 409 when user is already a member', async () => {
    mockFindUser.mockResolvedValueOnce({ id: 5, username: 'existing@test.com' });
    mockGetMember.mockResolvedValueOnce({ id: 1, role: 'member' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/1/members',
      payload: { username: 'existing@test.com', role: 'member' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when username is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/1/members',
      payload: { username: '', role: 'member' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/workspaces/:id/members', () => {
  it('returns list of members', async () => {
    mockListMembers.mockResolvedValueOnce([
      { id: 1, userId: 1, workspaceId: 1, role: 'workspace_admin', username: 'admin', displayName: 'Admin', createdAt: '2026-01-01' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces/1/members',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

describe('DELETE /api/workspaces/:id/members/:userId', () => {
  it('prevents removing last workspace admin', async () => {
    mockGetMember.mockResolvedValueOnce({ role: 'workspace_admin' });
    mockCountAdmins.mockResolvedValueOnce(1);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/workspaces/1/members/2',
    });

    expect(res.statusCode).toBe(400);
  });

  it('removes member successfully', async () => {
    mockGetMember.mockResolvedValueOnce({ role: 'member' });
    mockRemoveMember.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/workspaces/1/members/2',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
  });
});
