import { describe, it, expect } from 'vitest';
import {
  parseListParam,
  parseNumberListParam,
  parsePageParam,
  parseEnumParam,
  setOrDeleteParam,
} from './url-state';

describe('parseListParam', () => {
  it('splits a comma-separated value', () => {
    expect(parseListParam('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for null or empty', () => {
    expect(parseListParam(null)).toEqual([]);
    expect(parseListParam('')).toEqual([]);
  });

  it('drops empty entries from stray commas', () => {
    expect(parseListParam('a,,b,')).toEqual(['a', 'b']);
  });
});

describe('parseNumberListParam', () => {
  it('parses numeric entries', () => {
    expect(parseNumberListParam('1,2,30')).toEqual([1, 2, 30]);
  });

  it('drops non-numeric entries', () => {
    expect(parseNumberListParam('1,abc,3')).toEqual([1, 3]);
  });

  it('returns [] for null', () => {
    expect(parseNumberListParam(null)).toEqual([]);
  });
});

describe('parsePageParam', () => {
  it('maps a 1-based param to a 0-based index', () => {
    expect(parsePageParam('3')).toBe(2);
  });

  it('maps absent/invalid/first-page values to 0', () => {
    expect(parsePageParam(null)).toBe(0);
    expect(parsePageParam('1')).toBe(0);
    expect(parsePageParam('0')).toBe(0);
    expect(parsePageParam('-2')).toBe(0);
    expect(parsePageParam('abc')).toBe(0);
    expect(parsePageParam('1.5')).toBe(0);
  });
});

describe('parseEnumParam', () => {
  it('returns the value when allowed', () => {
    expect(parseEnumParam('desc', ['asc', 'desc'] as const)).toBe('desc');
  });

  it('returns null for absent or invalid values', () => {
    expect(parseEnumParam(null, ['asc', 'desc'] as const)).toBeNull();
    expect(parseEnumParam('sideways', ['asc', 'desc'] as const)).toBeNull();
  });
});

describe('setOrDeleteParam', () => {
  it('sets non-empty values', () => {
    const p = new URLSearchParams();
    setOrDeleteParam(p, 'q', 'alpha');
    expect(p.get('q')).toBe('alpha');
  });

  it('deletes the param for empty/null/undefined values (clean defaults)', () => {
    const p = new URLSearchParams('q=alpha&sort=name');
    setOrDeleteParam(p, 'q', '');
    setOrDeleteParam(p, 'sort', null);
    expect(p.toString()).toBe('');
  });
});
