import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { generatePassword } from '../lib/password.ts';
import { authorize } from '../lib/authorize.ts';
import {
  listWorkspaceMembers,
  addWorkspaceMember,
  updateMemberRole,
  removeWorkspaceMember,
  getWorkspaceMember,
  countWorkspaceAdmins,
  findUserByUsername,
  createUser,
} from '../orchestrator/entities.ts';

const SALT_ROUNDS = 12;

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api/workspaces/:id/members
  app.get('/workspaces/:id/members', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
    },
  }, async (request) => {
    const { id: workspaceId } = request.params;
    await authorize(request, workspaceId, 'member');
    return listWorkspaceMembers(workspaceId);
  });

  // POST /api/workspaces/:id/members
  app.post('/workspaces/:id/members', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
      body: z.object({
        username: z.string().min(1).max(128),
        role: z.enum(['workspace_admin', 'member']),
      }),
    },
  }, async (request, reply) => {
    const { id: workspaceId } = request.params;
    await authorize(request, workspaceId, 'workspace_admin');

    const { username, role } = request.body;

    let user = await findUserByUsername(username);
    let generatedPw: string | undefined;

    if (!user) {
      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      user = await createUser({
        username,
        passwordHash,
        displayName: username,
        role: 'user',
        mustChangePassword: true,
      });
      generatedPw = password;
    }

    const existing = await getWorkspaceMember(user.id, workspaceId);
    if (existing) {
      return reply.status(409).send({ error: 'User is already a member of this workspace' });
    }

    const member = await addWorkspaceMember({ userId: user.id, workspaceId, role });

    const response: Record<string, unknown> = { member };
    if (generatedPw) {
      response.generatedPassword = generatedPw;
    }
    return reply.status(201).send(response);
  });

  // PATCH /api/workspaces/:id/members/:userId
  app.patch('/workspaces/:id/members/:userId', {
    schema: {
      params: z.object({
        id: z.coerce.number(),
        userId: z.coerce.number(),
      }),
      body: z.object({
        role: z.enum(['workspace_admin', 'member']),
      }),
    },
  }, async (request, reply) => {
    const { id: workspaceId, userId } = request.params;
    await authorize(request, workspaceId, 'workspace_admin');

    const { role: newRole } = request.body;

    const current = await getWorkspaceMember(userId, workspaceId);
    if (!current) {
      return reply.status(404).send({ error: 'Member not found' });
    }

    if (current.role === 'workspace_admin' && newRole === 'member') {
      const adminCount = await countWorkspaceAdmins(workspaceId);
      if (adminCount <= 1) {
        return reply.status(400).send({ error: 'Cannot demote the last workspace admin' });
      }
    }

    const updated = await updateMemberRole(userId, workspaceId, newRole);
    if (!updated) {
      return reply.status(404).send({ error: 'Member not found' });
    }
    return updated;
  });

  // DELETE /api/workspaces/:id/members/:userId
  app.delete('/workspaces/:id/members/:userId', {
    schema: {
      params: z.object({
        id: z.coerce.number(),
        userId: z.coerce.number(),
      }),
    },
  }, async (request, reply) => {
    const { id: workspaceId, userId } = request.params;
    await authorize(request, workspaceId, 'workspace_admin');

    const current = await getWorkspaceMember(userId, workspaceId);
    if (!current) {
      return reply.status(404).send({ error: 'Member not found' });
    }

    if (current.role === 'workspace_admin') {
      const adminCount = await countWorkspaceAdmins(workspaceId);
      if (adminCount <= 1) {
        return reply.status(400).send({ error: 'Cannot remove the last workspace admin' });
      }
    }

    await removeWorkspaceMember(userId, workspaceId);
    return { deleted: true };
  });
};
