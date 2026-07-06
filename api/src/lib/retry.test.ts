import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetry } from './retry.ts';

describe('withRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { attempts: 3, backoffMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and returns the eventual success', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    const result = await withRetry(fn, { attempts: 3, backoffMs: 1 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));
    await expect(withRetry(fn, { attempts: 3, backoffMs: 1 })).rejects.toThrow('persistent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    const shouldRetry = vi.fn().mockReturnValue(false);
    await expect(withRetry(fn, { attempts: 3, backoffMs: 1, shouldRetry })).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error));
  });

  it('passes the error to shouldRetry for classification', async () => {
    const notFound = new Error('404');
    const fn = vi.fn().mockRejectedValue(notFound);
    const seen: unknown[] = [];
    await expect(withRetry(fn, {
      attempts: 2,
      backoffMs: 1,
      shouldRetry: (err) => { seen.push(err); return false; },
    })).rejects.toThrow('404');
    expect(seen).toEqual([notFound]);
  });

  it('defaults to 3 attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withRetry(fn, { backoffMs: 1 })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('waits with exponential backoff between attempts (never busy-waits)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const promise = withRetry(fn, { attempts: 3, backoffMs: 100 });
    const guard = promise.catch(() => {}); // avoid unhandled rejection noise

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // First backoff: 100ms
    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second backoff doubles: 200ms
    await vi.advanceTimersByTimeAsync(199);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    await expect(promise).rejects.toThrow('boom');
    await guard;
  });

  it('rejects attempts < 1 loudly', async () => {
    const fn = vi.fn();
    await expect(withRetry(fn, { attempts: 0 })).rejects.toThrow(/attempts/);
    expect(fn).not.toHaveBeenCalled();
  });
});
