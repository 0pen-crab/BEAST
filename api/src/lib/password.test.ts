import { describe, it, expect } from 'vitest';
import { generatePassword } from './password.ts';

describe('generatePassword', () => {
  it('returns an 8-character string', () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(8);
  });

  it('contains only alphanumeric characters', () => {
    const pw = generatePassword();
    expect(pw).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('generates unique passwords on successive calls', () => {
    const passwords = new Set(Array.from({ length: 10 }, () => generatePassword()));
    expect(passwords.size).toBe(10);
  });
});
