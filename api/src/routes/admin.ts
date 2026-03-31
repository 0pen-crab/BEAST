import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { authorizeSuperAdmin } from '../lib/authorize.ts';
import { generatePassword } from '../lib/password.ts';
import { db } from '../db/index.ts';
import { workspaces, workspaceMembers } from '../db/schema.ts';
import { sql } from 'drizzle-orm';
import {
  listAllUsers,
  createUser,
  updateUser,
  deleteUser,
  findUserById,
  findUserByUsername,
  countSuperAdmins,
  listUserWorkspaces,
  addWorkspaceMember,
  removeWorkspaceMember,
  updateMemberRole,
  listWorkspaceMembers,
} from '../orchestrator/entities.ts';

const SALT_ROUNDS = 12;

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api/admin/users
  app.get('/admin/users', {
  }, async (request) => {
    authorizeSuperAdmin(request);
    const users = await listAllUsers();
    const result = await Promise.all(users.map(async (user) => {
      const memberships = await listUserWorkspaces(user.id);
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt,
        workspaces: memberships.map(m => ({
          workspaceId: m.workspaceId,
          name: m.name,
          role: m.role,
        })),
      };
    }));
    return result;
  });

  // POST /api/admin/users
  app.post('/admin/users', {
    schema: {
      body: z.object({
        username: z.string().min(1).max(128),
        displayName: z.string().max(256).optional(),
      }),
    },
  }, async (request, reply) => {
    authorizeSuperAdmin(request);
    const { username, displayName } = request.body;

    const existing = await findUserByUsername(username);
    if (existing) {
      return reply.status(409).send({ error: 'Username already taken' });
    }

    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await createUser({
      username,
      passwordHash,
      displayName: displayName || username,
      role: 'user',
      mustChangePassword: true,
    });

    return reply.status(201).send({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      generatedPassword: password,
    });
  });

  // PATCH /api/admin/users/:id
  app.patch('/admin/users/:id', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
      body: z.object({
        displayName: z.string().max(256).optional(),
        resetPassword: z.boolean().optional(),
      }),
    },
  }, async (request, reply) => {
    authorizeSuperAdmin(request);
    const { id } = request.params;
    const { displayName, resetPassword } = request.body;

    const updates: { displayName?: string; passwordHash?: string } = {};
    let generatedPassword: string | undefined;

    if (displayName !== undefined) updates.displayName = displayName;
    if (resetPassword) {
      generatedPassword = generatePassword();
      updates.passwordHash = await bcrypt.hash(generatedPassword, SALT_ROUNDS);
    }

    const user = await updateUser(id, updates);
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      ...(generatedPassword ? { generatedPassword } : {}),
    };
  });

  // DELETE /api/admin/users/:id
  app.delete('/admin/users/:id', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
    },
  }, async (request, reply) => {
    authorizeSuperAdmin(request);
    const { id } = request.params;
    const user = request.user!;

    if (id === user.id) {
      return reply.status(400).send({ error: 'Cannot delete your own account' });
    }

    const target = await findUserById(id);
    if (!target) {
      return reply.status(404).send({ error: 'User not found' });
    }
    if (target.role === 'super_admin' && (await countSuperAdmins()) <= 1) {
      return reply.status(400).send({ error: 'Cannot delete the last super admin' });
    }

    await deleteUser(id);
    return { deleted: true };
  });

  // GET /api/admin/workspaces
  app.get('/admin/workspaces', {
  }, async (request) => {
    authorizeSuperAdmin(request);
    const rows = await db.select({
      id: workspaces.id,
      name: workspaces.name,
      description: workspaces.description,
      defaultLanguage: workspaces.defaultLanguage,
      createdAt: workspaces.createdAt,
      memberCount: sql<number>`(SELECT count(*) FROM workspace_members wm WHERE wm.workspace_id = "workspaces"."id")::int`,
      scanCount: sql<number>`(SELECT count(*) FROM scans s WHERE s.workspace_id = "workspaces"."id")::int`,
    }).from(workspaces);

    return rows;
  });
};
