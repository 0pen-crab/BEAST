import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('crypto', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('encrypt returns ciphertext and iv', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
    const { encrypt } = await import('./crypto.ts');
    const result = encrypt('hello world');
    expect(result.ciphertext).toBeTruthy();
    expect(result.iv).toBeTruthy();
    expect(result.ciphertext).not.toBe('hello world');
  });

  it('decrypt reverses encrypt', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
    const { encrypt, decrypt } = await import('./crypto.ts');
    const { ciphertext, iv } = encrypt('secret-token-123');
    const plain = decrypt(ciphertext, iv);
    expect(plain).toBe('secret-token-123');
  });

  it('decrypt fails with wrong key', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
    const mod1 = await import('./crypto.ts');
    const { ciphertext, iv } = mod1.encrypt('secret');

    // Re-import with different key — need to reset module
    vi.resetModules();
    vi.stubEnv('ENCRYPTION_KEY', 'b'.repeat(64));
    const mod2 = await import('./crypto.ts');
    expect(() => mod2.decrypt(ciphertext, iv)).toThrow();
  });

  it('decrypt fails with tampered ciphertext', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
    const { encrypt, decrypt } = await import('./crypto.ts');
    const { ciphertext, iv } = encrypt('secret');
    const tampered = 'AAAA' + ciphertext.slice(4);
    expect(() => decrypt(tampered, iv)).toThrow();
  });

  it('each encrypt call produces unique iv', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
    const { encrypt } = await import('./crypto.ts');
    const r1 = encrypt('same input');
    const r2 = encrypt('same input');
    expect(r1.iv).not.toBe(r2.iv);
    expect(r1.ciphertext).not.toBe(r2.ciphertext);
  });

  it('throws if ENCRYPTION_KEY is missing', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    vi.resetModules();
    const { encrypt } = await import('./crypto.ts');
    expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
  });

  it('throws if ENCRYPTION_KEY is wrong length', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'tooshort');
    vi.resetModules();
    const { encrypt } = await import('./crypto.ts');
    expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
  });

  it('throws if ENCRYPTION_KEY has invalid hex characters', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'z'.repeat(64));
    vi.resetModules();
    const { encrypt } = await import('./crypto.ts');
    expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
  });
});
