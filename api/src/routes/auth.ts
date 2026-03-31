import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import {
  findUserByUsername,
  findUserById,
  createSession,
  deleteSession,
  countUsers,
  createUser,
  updateUser,
} from '../orchestrator/entities.ts';
import { setSecret, getSecret } from '../lib/vault.ts';

const SALT_ROUNDS = 12;

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api/auth/setup-status — check if initial setup is needed
  app.get('/auth/setup-status', async () => {
    const count = await countUsers();
    return { needsSetup: count === 0 };
  });

  // POST /api/auth/setup — create the first admin account (only works when 0 users exist)
  app.post('/auth/setup', {
    schema: {
      body: z.object({
        username: z.string().min(1),
        password: z.string().min(6),
      }),
    },
  }, async (request, reply) => {
    const count = await countUsers();
    if (count > 0) {
      return reply.status(403).send({ error: 'Setup already completed' });
    }

    const { username, password } = request.body;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser({
      username,
      passwordHash,
      displayName: username,
      role: 'super_admin',
    });

    const session = await createSession(user.id);
    return {
      token: session.token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    };
  });

  // POST /api/auth/login
  app.post('/auth/login', {
    schema: {
      body: z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      }),
    },
  }, async (request, reply) => {
    const { username, password } = request.body;

    const user = await findUserByUsername(username);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const session = await createSession(user.id);
    return {
      token: session.token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        mustChangePassword: user.mustChangePassword ?? false,
      },
    };
  });

  // POST /api/auth/logout
  app.post('/auth/logout', async (request, reply) => {
    const authHeader = request.headers['authorization'];
    const token = authHeader?.replace(/^Token\s+/i, '').replace(/^Bearer\s+/i, '');
    if (token) {
      await deleteSession(token);
    }
    return reply.status(204).send();
  });

  // GET /api/auth/me — return current user from auth hook
  app.get('/auth/me', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    request.authorized = true;
    return {
      id: request.user.id,
      username: request.user.username,
      displayName: request.user.displayName,
      role: request.user.role,
      mustChangePassword: request.user.mustChangePassword,
    };
  });

  // PATCH /api/auth/password — change password (used for forced password change)
  app.patch('/auth/password', {
    schema: {
      body: z.object({
        newPassword: z.string().min(6),
      }),
    },
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    request.authorized = true;

    const passwordHash = await bcrypt.hash(request.body.newPassword, SALT_ROUNDS);
    await updateUser(request.user.id, { passwordHash, mustChangePassword: false });

    return { ok: true };
  });

  // PUT /api/auth/provider-token — save a user-level provider token (e.g. GitHub PAT)
  app.put(
    '/auth/provider-token',
    {
      schema: {
        body: z.object({
          provider: z.string(),
          token: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
      request.authorized = true;
      await setSecret({
        name: `${request.body.provider} PAT for ${request.user.username}`,
        value: request.body.token,
        ownerType: 'user',
        ownerId: request.user.id,
        label: `${request.body.provider}_pat`,
      });
      return { ok: true };
    },
  );

  // GET /api/auth/provider-token/:provider — check if user has a token for a provider
  app.get(
    '/auth/provider-token/:provider',
    {
      schema: {
        params: z.object({ provider: z.string() }),
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
      request.authorized = true;
      const token = await getSecret('user', request.user.id, `${request.params.provider}_pat`);
      return { hasToken: !!token };
    },
  );
};
