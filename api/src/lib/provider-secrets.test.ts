import { describe, it, expect } from 'vitest';
import { PROVIDER_SECRETS, type SecretFieldDef } from './provider-secrets.ts';

describe('PROVIDER_SECRETS', () => {
  it('defines secrets for all supported providers', () => {
    expect(PROVIDER_SECRETS.bitbucket).toBeDefined();
    expect(PROVIDER_SECRETS.github).toBeDefined();
    expect(PROVIDER_SECRETS.gitlab).toBeDefined();
    expect(PROVIDER_SECRETS.jfrog).toBeDefined();
  });

  it('each provider has at least one required secret', () => {
    for (const [provider, fields] of Object.entries(PROVIDER_SECRETS)) {
      const required = fields.filter((f: SecretFieldDef) => f.required);
      expect(required.length, `${provider} should have at least one required secret`).toBeGreaterThan(0);
    }
  });

  it('labels are unique within each provider', () => {
    for (const [provider, fields] of Object.entries(PROVIDER_SECRETS)) {
      const labels = fields.map((f: SecretFieldDef) => f.label);
      const unique = new Set(labels);
      expect(unique.size, `${provider} has duplicate labels`).toBe(labels.length);
    }
  });

  it('each field has label, displayName, and required', () => {
    for (const fields of Object.values(PROVIDER_SECRETS)) {
      for (const field of fields) {
        expect(field.label).toBeTruthy();
        expect(field.displayName).toBeTruthy();
        expect(typeof field.required).toBe('boolean');
      }
    }
  });
});
