import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadStoredColumns } from './stored-columns';

const KEY = 'test_columns';
const DEFAULTS = ['a', 'b', 'c'];

describe('loadStoredColumns', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadStoredColumns(KEY, DEFAULTS)).toEqual(new Set(DEFAULTS));
  });

  it('returns the stored selection when valid JSON', () => {
    localStorage.setItem(KEY, JSON.stringify(['a', 'c']));
    expect(loadStoredColumns(KEY, DEFAULTS)).toEqual(new Set(['a', 'c']));
  });

  it('self-heals corrupt storage: removes the key and returns defaults', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(KEY, '{not json');

    expect(loadStoredColumns(KEY, DEFAULTS)).toEqual(new Set(DEFAULTS));
    // Corrupt value is gone — the next load won't hit the parse error again
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('self-heals non-array JSON (old format)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(KEY, JSON.stringify({ old: 'format' }));

    expect(loadStoredColumns(KEY, DEFAULTS)).toEqual(new Set(DEFAULTS));
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
