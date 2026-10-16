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

  it('disables the i18next/Locize support-notice console promo', async () => {
    const mod = await import('./i18n');
    expect(mod.default.options.showSupportNotice).toBe(false);
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

  it('pluralizes common.resultsCount correctly in uk and en', async () => {
    const { default: i18n, setLanguage } = await import('./i18n');
    setLanguage('uk');
    expect(i18n.t('common.resultsCount', { count: 1 })).toBe('1 результат');
    expect(i18n.t('common.resultsCount', { count: 3 })).toBe('3 результати');
    expect(i18n.t('common.resultsCount', { count: 7 })).toBe('7 результатів');
    setLanguage('en');
    expect(i18n.t('common.resultsCount', { count: 1 })).toBe('1 result');
    expect(i18n.t('common.resultsCount', { count: 2 })).toBe('2 results');
  });

  it('pluralizes repos and contributors counts in uk', async () => {
    const { default: i18n, setLanguage } = await import('./i18n');
    setLanguage('uk');
    expect(i18n.t('common.reposCount', { count: 1 })).toBe('1 репозиторій');
    expect(i18n.t('common.reposCount', { count: 2 })).toBe('2 репозиторії');
    expect(i18n.t('common.reposCount', { count: 13 })).toBe('13 репозиторіїв');
    expect(i18n.t('contributors.count', { count: 13 })).toBe('13 контрибʼюторів');
    setLanguage('en');
    expect(i18n.t('common.reposCount', { count: 13 })).toBe('13 repos');
    expect(i18n.t('contributors.count', { count: 1 })).toBe('1 contributor');
  });

  it('localizes relative time and duration units', async () => {
    const { default: i18n, setLanguage } = await import('./i18n');
    setLanguage('uk');
    expect(i18n.t('common.justNow')).toBe('щойно');
    expect(i18n.t('common.minutesAgo', { count: 2 })).toBe('2 хв тому');
    expect(i18n.t('common.durationMS', { m: 2, s: 14 })).toBe('2 хв 14 с');
    setLanguage('en');
    expect(i18n.t('common.durationMS', { m: 2, s: 14 })).toBe('2m 14s');
  });

  it('defines a translated description for every backend tool key in en and uk', async () => {
    const en = (await import('@/locales/en.json')).default as Record<string, any>;
    const uk = (await import('@/locales/uk.json')).default as Record<string, any>;
    const toolKeys = [
      'gitleaks', 'trufflehog', 'trivy-secrets', 'gitguardian',
      'semgrep', 'snyk-code',
      'osv-scanner', 'trivy-sca', 'snyk-sca', 'jfrog',
      'checkov', 'trivy-iac', 'snyk-iac',
      'presidio', 'semgrep-pii',
    ];
    for (const [name, locale] of [['en', en], ['uk', uk]] as const) {
      for (const k of toolKeys) {
        expect(typeof locale.tools.descriptions[k], `${name} tools.descriptions.${k}`).toBe('string');
      }
    }
    // uk descriptions are actually translated, not copies of the English ones
    expect(uk.tools.descriptions.gitleaks).not.toBe(en.tools.descriptions.gitleaks);
  });

  it('translates the uk scan-depth preset labels and badges', async () => {
    const uk = (await import('@/locales/uk.json')).default as Record<string, any>;
    const sd = uk.settings.scanDepth;
    // Formerly untranslated "QUICK" / "STANDARD" / "DEEP"
    expect(sd.quick.label).not.toBe('QUICK');
    expect(sd.standard.label).not.toBe('STANDARD');
    expect(sd.deep.label).not.toBe('DEEP');
    expect(typeof sd.standard.badge).toBe('string');
    expect(typeof sd.deep.badge).toBe('string');
    expect(typeof sd.filesApprox).toBe('string');
  });
});
