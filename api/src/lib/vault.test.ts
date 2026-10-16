import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
vi.mock('../db/index.ts', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}));

// Mock crypto module
vi.mock('./crypto.ts', () => ({
  encrypt: vi.fn().mockReturnValue({ ciphertext: 'encrypted-base64', iv: 'aabbccdd' }),
  decrypt: vi.fn().mockReturnValue('decrypted-plaintext'),
}));

import { db } from '../db/index.ts';
import { encrypt, decrypt } from './crypto.ts';

describe('vault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setSecret', () => {
    it('creates a new secret and ref in a transaction', async () => {
      const { setSecret } = await import('./vault.ts');

      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
      (db.transaction as any).mockImplementation(async (fn: any) => fn(mockTx));

      await setSecret({
        name: 'Bitbucket Token',
        value: 'my-secret-token',
        workspaceId: 1,
        ownerType: 'source',
        ownerId: 5,
        label: 'access_token',
      });

      expect(encrypt).toHaveBeenCalledWith('my-secret-token');
      expect(mockTx.insert).toHaveBeenCalledTimes(2); // secrets + secret_refs
    });

    it('upserts when owner/label already exists', async () => {
      const { setSecret } = await import('./vault.ts');

      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 10, secretId: 42 }]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 42 }]),
            }),
          }),
        }),
        insert: vi.fn(),
      };
      (db.transaction as any).mockImplementation(async (fn: any) => fn(mockTx));

      await setSecret({
        name: 'Updated Token',
        value: 'new-value',
        ownerType: 'source',
        ownerId: 5,
        label: 'access_token',
      });

      expect(encrypt).toHaveBeenCalledWith('new-value');
      expect(mockTx.update).toHaveBeenCalled();
      expect(mockTx.insert).not.toHaveBeenCalled();
    });
  });

  describe('getSecret', () => {
    it('returns decrypted value for existing secret', async () => {
      const { getSecret } = await import('./vault.ts');

      const mockResult = [{
        encryptedValue: 'encrypted-base64',
        iv: 'aabbccdd',
      }];

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(mockResult),
          }),
        }),
      });

      const result = await getSecret('source', 5, 'access_token');
      expect(decrypt).toHaveBeenCalledWith('encrypted-base64', 'aabbccdd');
      expect(result).toBe('decrypted-plaintext');
    });

    it('returns null for missing secret', async () => {
      const { getSecret } = await import('./vault.ts');

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getSecret('source', 99, 'access_token');
      expect(result).toBeNull();
    });
  });

  describe('getOwnerSecrets', () => {
    it('returns all decrypted secrets for an owner', async () => {
      const { getOwnerSecrets } = await import('./vault.ts');

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { label: 'access_token', encryptedValue: 'enc1', iv: 'iv1' },
              { label: 'webhook_secret', encryptedValue: 'enc2', iv: 'iv2' },
            ]),
          }),
        }),
      });

      const result = await getOwnerSecrets('source', 5);
      expect(decrypt).toHaveBeenCalledTimes(2);
      expect(Object.keys(result)).toEqual(['access_token', 'webhook_secret']);
    });
  });

  describe('deleteOwnerSecrets', () => {
    it('deletes both refs and secrets in a transaction', async () => {
      const { deleteOwnerSecrets } = await import('./vault.ts');

      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ secretId: 1 }, { secretId: 2 }]),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      };
      (db.transaction as any).mockImplementation(async (fn: any) => fn(mockTx));

      await deleteOwnerSecrets('source', 5);

      // Should delete secret_refs first, then the secrets
      expect(mockTx.delete).toHaveBeenCalledTimes(2);
    });

    it('does nothing if no secrets found', async () => {
      const { deleteOwnerSecrets } = await import('./vault.ts');

      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        delete: vi.fn(),
      };
      (db.transaction as any).mockImplementation(async (fn: any) => fn(mockTx));

      await deleteOwnerSecrets('source', 5);
      expect(mockTx.delete).not.toHaveBeenCalled();
    });
  });

  describe('deleteSecret', () => {
    it('deletes a single secret by owner + label', async () => {
      const { deleteSecret } = await import('./vault.ts');

      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 10, secretId: 42 }]),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      };
      (db.transaction as any).mockImplementation(async (fn: any) => fn(mockTx));

      await deleteSecret('source', 5, 'access_token');
      expect(mockTx.delete).toHaveBeenCalledTimes(2); // ref + secret
    });
  });
});
