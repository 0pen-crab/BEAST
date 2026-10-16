import { describe, it, expect } from 'vitest';
import { resolveModelFlag, AI_MODEL_KEYS, HARDCODED_MODELS, MODEL_REGISTRY, contextWindowForModel } from './ai-models.ts';

describe('resolveModelFlag', () => {
  it('maps "opus" to claude-opus-4-6[1m]', () => {
    expect(resolveModelFlag('opus')).toBe('claude-opus-4-6[1m]');
  });

  it('maps "sonnet" to claude-sonnet-5', () => {
    expect(resolveModelFlag('sonnet')).toBe('claude-sonnet-5[1m]');
  });

  it('maps "haiku" to claude-haiku-4-5-20251001', () => {
    expect(resolveModelFlag('haiku')).toBe('claude-haiku-4-5-20251001');
  });

  it('falls back to default when key is unknown', () => {
    expect(resolveModelFlag('unknown-model', 'sonnet')).toBe('claude-sonnet-5[1m]');
  });

  it('falls back to opus when key is unknown and no default provided', () => {
    expect(resolveModelFlag('garbage')).toBe('claude-opus-4-6[1m]');
  });

  it('falls back to default when key is empty', () => {
    expect(resolveModelFlag('', 'haiku')).toBe('claude-haiku-4-5-20251001');
  });
});

describe('AI_MODEL_KEYS', () => {
  it('contains exactly opus, sonnet, haiku', () => {
    expect(AI_MODEL_KEYS).toEqual(['opus', 'sonnet', 'haiku']);
  });
});

describe('HARDCODED_MODELS', () => {
  it('has feedback set to sonnet', () => {
    expect(HARDCODED_MODELS.feedback).toBe('claude-sonnet-5[1m]');
  });

  it('has highlights set to haiku', () => {
    expect(HARDCODED_MODELS.highlights).toBe('claude-haiku-4-5-20251001');
  });
});

describe('MODEL_REGISTRY', () => {
  it('every entry declares a positive contextWindow (maintainer rule: no model without a window)', () => {
    for (const [key, spec] of Object.entries(MODEL_REGISTRY)) {
      expect(typeof spec.contextWindow, `registry entry "${key}" must have a numeric contextWindow`).toBe('number');
      expect(spec.contextWindow, `registry entry "${key}" must have a positive contextWindow`).toBeGreaterThan(0);
      expect(typeof spec.cliId).toBe('string');
    }
  });

  it('the [1m] CLI variants carry the 1M window', () => {
    expect(MODEL_REGISTRY.opus.contextWindow).toBe(1_000_000);
    expect(MODEL_REGISTRY.sonnet.contextWindow).toBe(1_000_000);
    expect(MODEL_REGISTRY.haiku.contextWindow).toBe(200_000);
  });
});

describe('contextWindowForModel', () => {
  describe('plain API ids (no [1m] suffix, as reported in modelUsage)', () => {
    it('resolves claude-sonnet-5 to the 200K standard window', () => {
      expect(contextWindowForModel('claude-sonnet-5')).toBe(200_000);
    });

    it('resolves claude-opus-4-6 to 200K (1M is beta-only via [1m])', () => {
      expect(contextWindowForModel('claude-opus-4-6')).toBe(200_000);
    });

    it('resolves claude-sonnet-4-6 to 200K', () => {
      expect(contextWindowForModel('claude-sonnet-4-6')).toBe(200_000);
    });

    it('resolves claude-haiku-4-5 to 200K', () => {
      expect(contextWindowForModel('claude-haiku-4-5')).toBe(200_000);
    });
  });

  describe('date-suffixed API ids', () => {
    it('strips -YYYYMMDD suffixes when matching the family', () => {
      expect(contextWindowForModel('claude-opus-4-6-20261101')).toBe(200_000);
      expect(contextWindowForModel('claude-haiku-4-5-20251001')).toBe(200_000);
      expect(contextWindowForModel('claude-sonnet-5-20260301')).toBe(200_000);
    });
  });

  describe('[1m] CLI ids', () => {
    it('resolves the 1M beta variants', () => {
      expect(contextWindowForModel('claude-sonnet-5[1m]')).toBe(1_000_000);
      expect(contextWindowForModel('claude-opus-4-6[1m]')).toBe(1_000_000);
    });

    it('returns undefined for a [1m] variant not registered as launchable (no guessing)', () => {
      expect(contextWindowForModel('claude-haiku-4-5[1m]')).toBeUndefined();
    });
  });

  describe('launched-model preference (API responses strip the [1m] suffix)', () => {
    it('uses the 1M window when the same family was launched as the [1m] variant', () => {
      expect(contextWindowForModel('claude-sonnet-5', 'claude-sonnet-5[1m]')).toBe(1_000_000);
    });

    it('handles date-suffixed API ids against the launched [1m] variant', () => {
      expect(contextWindowForModel('claude-sonnet-5-20260301', 'claude-sonnet-5[1m]')).toBe(1_000_000);
      expect(contextWindowForModel('claude-opus-4-6-20261101', 'claude-opus-4-6[1m]')).toBe(1_000_000);
    });

    it('ignores the launched model when the reported family differs (e.g. internal routing model)', () => {
      expect(contextWindowForModel('claude-haiku-4-5-20251001', 'claude-sonnet-5[1m]')).toBe(200_000);
    });

    it('falls back to API-id resolution when the launched id is not in the registry', () => {
      expect(contextWindowForModel('claude-sonnet-5', 'claude-sonnet-5[weird]')).toBe(200_000);
    });
  });

  describe('unknown models', () => {
    it('returns undefined instead of guessing 200K', () => {
      expect(contextWindowForModel('claude-mystery-9')).toBeUndefined();
      expect(contextWindowForModel('gpt-7-turbo')).toBeUndefined();
      expect(contextWindowForModel('')).toBeUndefined();
    });
  });
});
