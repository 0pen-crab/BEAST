import { describe, it, expect } from 'vitest';
import { PROVIDER_DISPLAY, sourceDisplayLabel } from './provider-display';

describe('sourceDisplayLabel', () => {
  it('cloud/group sources: shows orgName as-is', () => {
    expect(sourceDisplayLabel({ provider: 'github', baseUrl: 'https://api.github.com', orgName: 'acme-org' })).toBe('acme-org');
    expect(sourceDisplayLabel({ provider: 'gitlab', baseUrl: 'https://gitlab.example.com', orgName: 'some-group' })).toBe('some-group');
  });

  it('self-hosted server-wide (no orgName): shows cleaned host', () => {
    expect(sourceDisplayLabel({ provider: 'gitlab', baseUrl: 'https://gitlab.example.com', orgName: null })).toBe('gitlab.example.com');
  });

  it('strips scheme and any path from the host', () => {
    expect(sourceDisplayLabel({ provider: 'gitlab', baseUrl: 'https://git.example.com/api/v4', orgName: null })).toBe('git.example.com');
  });

  it('local upload (no orgName): shows provider display label', () => {
    expect(sourceDisplayLabel({ provider: 'local', baseUrl: 'local://uploads/abc', orgName: null })).toBe('Local');
  });

  it('falls back to provider label when baseUrl is unparseable and no orgName', () => {
    expect(sourceDisplayLabel({ provider: 'gitlab', baseUrl: '', orgName: null })).toBe('GitLab');
  });
});

describe('PROVIDER_DISPLAY', () => {
  it('has entries for github, gitlab, bitbucket, local', () => {
    expect(PROVIDER_DISPLAY.github).toBeDefined();
    expect(PROVIDER_DISPLAY.gitlab).toBeDefined();
    expect(PROVIDER_DISPLAY.bitbucket).toBeDefined();
    expect(PROVIDER_DISPLAY.local).toBeDefined();
  });

  it('each entry has label and color', () => {
    for (const [, entry] of Object.entries(PROVIDER_DISPLAY)) {
      expect(entry.label).toBeTruthy();
      expect(entry.color).toBeTruthy();
    }
  });

  it('github label is GitHub', () => {
    expect(PROVIDER_DISPLAY.github.label).toBe('GitHub');
  });

  it('returns local as fallback-friendly', () => {
    expect(PROVIDER_DISPLAY.local).toBeDefined();
  });
});
