import { randomBytes } from 'crypto';

const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generatePassword(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join('');
}
