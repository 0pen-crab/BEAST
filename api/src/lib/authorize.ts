import type { FastifyRequest } from 'fastify';
import { getWorkspaceMember } from '../orchestrator/entities.ts';

type Role = 'super_admin' | 'workspace_admin' | 'member';

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Authorize a request against a workspace.
 * Call this in every handler that accesses workspace-scoped data.
 * Sets request.authorized = true on success.
 * Throws ForbiddenError on failure.
 */
export async function authorize(request: FastifyRequest, workspaceId: number, minRole: Role): Promise<void> {
  const user = request.user;
  if (!user) throw new ForbiddenError('Unauthorized');

  // Super admin bypasses workspace checks
  if (user.role === 'super_admin') {
    request.authorized = true;
    return;
  }

  const membership = await getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    throw new ForbiddenError('Not a member of this workspace');
  }

  if (minRole === 'member') {
    request.authorized = true;
    return;
  }

  if (minRole === 'workspace_admin' && membership.role === 'workspace_admin') {
    request.authorized = true;
    return;
  }

  throw new ForbiddenError('Insufficient role');
}

/**
 * Authorize super_admin-only actions.
 */
export function authorizeSuperAdmin(request: FastifyRequest): void {
  const user = request.user;
  if (!user) throw new ForbiddenError('Unauthorized');
  if (user.role !== 'super_admin') throw new ForbiddenError('Requires super admin');
  request.authorized = true;
}

/**
 * Mark request as authorized for public/auth endpoints.
 */
export function authorizePublic(request: FastifyRequest): void {
  request.authorized = true;
}
