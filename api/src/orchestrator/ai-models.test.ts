import { describe, it, expect } from 'vitest';
import { resolveModelFlag, AI_MODEL_KEYS, HARDCODED_MODELS } from './ai-models.ts';

describe('resolveModelFlag', () => {
  it('maps "opus" to claude-opus-4-6[1m]', () => {
    expect(resolveModelFlag('opus')).toBe('claude-opus-4-6[1m]');
  });

  it('maps "sonnet" to claude-sonnet-4-6', () => {
    expect(resolveModelFlag('sonnet')).toBe('claude-sonnet-4-6');
  });

  it('maps "haiku" to claude-haiku-4-5-20251001', () => {
    expect(resolveModelFlag('haiku')).toBe('claude-haiku-4-5-20251001');
  });

  it('falls back to default when key is unknown', () => {
    expect(resolveModelFlag('unknown-model', 'sonnet')).toBe('claude-sonnet-4-6');
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
    expect(HARDCODED_MODELS.feedback).toBe('claude-sonnet-4-6');
  });

  it('has highlights set to haiku', () => {
    expect(HARDCODED_MODELS.highlights).toBe('claude-haiku-4-5-20251001');
  });
});
