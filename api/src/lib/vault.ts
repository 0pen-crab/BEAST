import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { secrets, secretRefs, type Secret } from '../db/schema.ts';
import { encrypt, decrypt } from './crypto.ts';

export async function setSecret(opts: {
  name: string;
  value: string;
  workspaceId?: number;
  ownerType: string;
  ownerId: number;
  label: string;
}): Promise<Secret> {
  return db.transaction(async (tx) => {
    // Check for existing ref
    const existing = await tx.select()
      .from(secretRefs)
      .where(and(
        eq(secretRefs.ownerType, opts.ownerType),
        eq(secretRefs.ownerId, opts.ownerId),
        eq(secretRefs.label, opts.label),
      ));

    const { ciphertext, iv } = encrypt(opts.value);

    if (existing[0]) {
      // Upsert: update the existing secret's value
      const [updated] = await tx.update(secrets)
        .set({
          name: opts.name,
          encryptedValue: ciphertext,
          iv,
          updatedAt: new Date(),
        })
        .where(eq(secrets.id, existing[0].secretId))
        .returning();
      return updated;
    }

    // Create new secret + ref
    const [secret] = await tx.insert(secrets).values({
      workspaceId: opts.workspaceId ?? null,
      name: opts.name,
      encryptedValue: ciphertext,
      iv,
    }).returning();

    await tx.insert(secretRefs).values({
      secretId: secret.id,
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      label: opts.label,
    });

    return secret;
  });
}

export async function getSecret(
  ownerType: string,
  ownerId: number,
  label: string,
): Promise<string | null> {
  const rows = await db.select({
    encryptedValue: secrets.encryptedValue,
    iv: secrets.iv,
  })
    .from(secretRefs)
    .innerJoin(secrets, eq(secretRefs.secretId, secrets.id))
    .where(and(
      eq(secretRefs.ownerType, ownerType),
      eq(secretRefs.ownerId, ownerId),
      eq(secretRefs.label, label),
    ));

  if (!rows[0]) return null;
  return decrypt(rows[0].encryptedValue, rows[0].iv);
}

export async function getOwnerSecrets(
  ownerType: string,
  ownerId: number,
): Promise<Record<string, string>> {
  const rows = await db.select({
    label: secretRefs.label,
    encryptedValue: secrets.encryptedValue,
    iv: secrets.iv,
  })
    .from(secretRefs)
    .innerJoin(secrets, eq(secretRefs.secretId, secrets.id))
    .where(and(
      eq(secretRefs.ownerType, ownerType),
      eq(secretRefs.ownerId, ownerId),
    ));

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.label] = decrypt(row.encryptedValue, row.iv);
  }
  return result;
}

export async function deleteSecret(
  ownerType: string,
  ownerId: number,
  label: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const refs = await tx.select()
      .from(secretRefs)
      .where(and(
        eq(secretRefs.ownerType, ownerType),
        eq(secretRefs.ownerId, ownerId),
        eq(secretRefs.label, label),
      ));

    if (refs.length === 0) return;

    const secretIds = refs.map((r) => r.secretId);
    await tx.delete(secretRefs).where(and(
      eq(secretRefs.ownerType, ownerType),
      eq(secretRefs.ownerId, ownerId),
      eq(secretRefs.label, label),
    ));
    await tx.delete(secrets).where(inArray(secrets.id, secretIds));
  });
}

export async function deleteOwnerSecrets(
  ownerType: string,
  ownerId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const refs = await tx.select()
      .from(secretRefs)
      .where(and(
        eq(secretRefs.ownerType, ownerType),
        eq(secretRefs.ownerId, ownerId),
      ));

    if (refs.length === 0) return;

    const secretIds = refs.map((r) => r.secretId);
    await tx.delete(secretRefs).where(and(
      eq(secretRefs.ownerType, ownerType),
      eq(secretRefs.ownerId, ownerId),
    ));
    await tx.delete(secrets).where(inArray(secrets.id, secretIds));
  });
}
