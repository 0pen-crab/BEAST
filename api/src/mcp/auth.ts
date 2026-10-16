import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { apiKeys } from '../db/schema.ts';

export interface ValidatedApiKey {
  id: number;
  workspaceId: number;
  userId: number;
  name: string;
}

/** SHA-256 hash of a raw API key — same algorithm used at creation time. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Validate a raw API key: hash it, look up in api_keys table.
 * Returns key metadata on success, null on failure.
 * Updates lastUsedAt fire-and-forget (never blocks the response).
 */
export async function validateApiKey(raw: string): Promise<ValidatedApiKey | null> {
  const keyHash = hashApiKey(raw);

  const rows = await db
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      userId: apiKeys.userId,
      name: apiKeys.name,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (rows.length === 0) return null;

  const key = rows[0];

  // Check expiry
  if (key.expiresAt && key.expiresAt < new Date()) return null;

  // Update lastUsedAt — fire-and-forget
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch((err) => console.error('[mcp] Failed to update lastUsedAt:', err));

  return {
    id: key.id,
    workspaceId: key.workspaceId,
    userId: key.userId,
    name: key.name,
  };
}
