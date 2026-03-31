import { describe, it, expect } from 'vitest';
import { PROVIDER_DISPLAY } from './provider-display';

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
