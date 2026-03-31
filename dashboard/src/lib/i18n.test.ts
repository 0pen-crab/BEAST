import { describe, it, expect, beforeEach } from 'vitest';

describe('i18n', () => {
  beforeEach(() => {
    localStorage.removeItem('beast_language');
  });

  it('exports setLanguage and getLanguage helpers', async () => {
    const mod = await import('./i18n');
    expect(typeof mod.setLanguage).toBe('function');
    expect(typeof mod.getLanguage).toBe('function');
  });

  it('exports i18n instance as default', async () => {
    const mod = await import('./i18n');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.t).toBe('function');
  });

  it('getLanguage returns current language', async () => {
    const { getLanguage } = await import('./i18n');
    const lang = getLanguage();
    // Should be 'en' by default (fallback) or whatever was set
    expect(typeof lang).toBe('string');
    expect(lang.length).toBeGreaterThan(0);
  });

  it('setLanguage updates language and localStorage', async () => {
    const { setLanguage, getLanguage } = await import('./i18n');
    setLanguage('uk');
    expect(getLanguage()).toBe('uk');
    expect(localStorage.getItem('beast_language')).toBe('uk');

    // Reset back to en
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(localStorage.getItem('beast_language')).toBe('en');
  });
});
