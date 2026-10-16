import { describe, it, expect } from 'vitest';
import {
  stripNul,
  sanitizeForDb,
  sanitizeScanError,
  truncateScanErrorForList,
  truncateEventMessage,
  trimStepPayloadForApi,
} from './sanitize.ts';

const NUL = '\u0000';

describe('stripNul', () => {
  it('removes NUL characters', () => {
    expect(stripNul(`ab${NUL}cd${NUL}`)).toBe('abcd');
  });

  it('returns clean strings unchanged (same reference)', () => {
    const s = 'clean';
    expect(stripNul(s)).toBe(s);
  });
});

describe('sanitizeForDb', () => {
  it('deep-strips NULs from nested objects and arrays', () => {
    const plan = {
      preparedFindings: [
        { title: `SQLi${NUL}`, codeSnippet: `a${NUL}b`, line: 3 },
      ],
      note: null,
      nested: { arr: [`x${NUL}`, 7, true] },
    };
    expect(sanitizeForDb(plan)).toEqual({
      preparedFindings: [{ title: 'SQLi', codeSnippet: 'ab', line: 3 }],
      note: null,
      nested: { arr: ['x', 7, true] },
    });
  });

  it('leaves numbers, booleans, null and Dates alone', () => {
    const d = new Date();
    expect(sanitizeForDb(42)).toBe(42);
    expect(sanitizeForDb(null)).toBe(null);
    expect(sanitizeForDb(d)).toBe(d);
  });

  it('sanitizes object keys too', () => {
    expect(sanitizeForDb({ [`k${NUL}ey`]: 'v' })).toEqual({ key: 'v' });
  });
});

describe('sanitizeScanError', () => {
  it('cuts the drizzle params dump entirely', () => {
    const msg = 'Failed query: update "scan_steps" set ...\nparams: completed,{"huge":"plan"}';
    const out = sanitizeScanError(msg);
    expect(out).toContain('Failed query');
    expect(out).toContain('params: <omitted>');
    expect(out).not.toContain('huge');
  });

  it('caps the length and reports the original size', () => {
    const msg = 'x'.repeat(50_000);
    const out = sanitizeScanError(msg);
    expect(out.length).toBeLessThan(9_000);
    expect(out).toContain('(truncated, 50000 chars total)');
  });

  it('strips NULs', () => {
    expect(sanitizeScanError(`boom${NUL}!`)).toBe('boom!');
  });

  it('leaves short clean messages unchanged', () => {
    expect(sanitizeScanError('Clone failed (exit 128): fatal')).toBe('Clone failed (exit 128): fatal');
  });
});

describe('truncateScanErrorForList', () => {
  it('passes null through', () => {
    expect(truncateScanErrorForList(null)).toBeNull();
  });

  it('leaves short errors unchanged (same reference)', () => {
    const s = 'Clone failed (exit 128)';
    expect(truncateScanErrorForList(s)).toBe(s);
  });

  it('caps a legacy 10MB error to ~2000 chars with a marker', () => {
    const huge = 'e'.repeat(10 * 1024 * 1024);
    const out = truncateScanErrorForList(huge);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThan(2_100);
    expect(out!.startsWith('e'.repeat(2_000))).toBe(true);
    expect(out!.endsWith('… (truncated)')).toBe(true);
  });

  it('does not touch errors exactly at the cap', () => {
    const s = 'x'.repeat(2_000);
    expect(truncateScanErrorForList(s)).toBe(s);
  });
});

describe('truncateEventMessage', () => {
  it('leaves short clean messages unchanged (same reference)', () => {
    const s = 'clone completed';
    expect(truncateEventMessage(s)).toBe(s);
  });

  it('strips NULs like the previous stripNul call site', () => {
    expect(truncateEventMessage(`a${NUL}b`)).toBe('ab');
  });

  it('caps long messages at 4000 chars with a marker', () => {
    const out = truncateEventMessage('m'.repeat(100_000));
    expect(out.length).toBeLessThan(4_100);
    expect(out.startsWith('m'.repeat(4_000))).toBe(true);
    expect(out).toContain('… (truncated, 100000 chars total)');
  });

  it('does not touch messages exactly at the cap', () => {
    const s = 'y'.repeat(4_000);
    expect(truncateEventMessage(s)).toBe(s);
  });
});

describe('trimStepPayloadForApi', () => {
  it('passes null/undefined through', () => {
    expect(trimStepPayloadForApi(null)).toBeNull();
    expect(trimStepPayloadForApi(undefined)).toBeUndefined();
  });

  it('leaves normal small payloads unchanged', () => {
    const output = { findingsPrepared: 12, testsPrepared: 3, repositoryId: 7, nested: { ok: true } };
    expect(trimStepPayloadForApi(output)).toEqual(output);
  });

  it('replaces heavy staged-plan arrays with count markers', () => {
    const output = {
      repositoryId: 7,
      findingsPrepared: 366,
      preparedFindings: Array.from({ length: 366 }, (_, i) => ({ tempId: i, title: 't', fingerprint: 'f' })),
      preparedTests: [{ key: 'gitleaks' }, { key: 'semgrep' }],
      resultFiles: [{ key: 'gitleaks', content_b64: 'A'.repeat(1000) }],
      analyzerAssessments: [],
    };
    expect(trimStepPayloadForApi(output)).toEqual({
      repositoryId: 7,
      findingsPrepared: 366,
      preparedFindings: '<omitted: 366 items>',
      preparedTests: '<omitted: 2 items>',
      resultFiles: '<omitted: 1 items>',
      analyzerAssessments: '<omitted: 0 items>',
    });
  });

  it('replaces heavy keys nested deeper in the payload', () => {
    const output = { plan: { preparedFindings: [{ tempId: 1 }], note: 'keep' }, list: [{ resultFiles: [1, 2] }] };
    expect(trimStepPayloadForApi(output)).toEqual({
      plan: { preparedFindings: '<omitted: 1 items>', note: 'keep' },
      list: [{ resultFiles: '<omitted: 2 items>' }],
    });
  });

  it('replaces a non-array heavy value with a plain marker', () => {
    const output = { resultFiles: { oops: 'object-shaped' } };
    expect(trimStepPayloadForApi(output)).toEqual({ resultFiles: '<omitted>' });
  });

  it('hard-caps payloads that are still huge after key stripping', () => {
    const output = { rawLog: 'z'.repeat(9 * 1024 * 1024) };
    const trimmed = trimStepPayloadForApi(output) as Record<string, unknown>;
    expect(JSON.stringify(trimmed).length).toBeLessThan(60_000);
    expect(trimmed['<truncated>']).toContain('capped at 50000');
    expect(typeof trimmed.preview).toBe('string');
    expect((trimmed.preview as string).startsWith('{"rawLog":"zzz')).toBe(true);
  });

  it('does not mutate the original payload', () => {
    const output = { preparedFindings: [{ tempId: 1 }] };
    trimStepPayloadForApi(output);
    expect(output.preparedFindings).toEqual([{ tempId: 1 }]);
  });
});
