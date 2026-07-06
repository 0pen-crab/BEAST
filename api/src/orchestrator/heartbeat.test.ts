import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../db/index.ts';

const mockDb = db as any;

import {
  startWorkerHeartbeat,
  stopWorkerHeartbeat,
  beatOnce,
  HEARTBEAT_INTERVAL_MS,
} from './heartbeat.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  stopWorkerHeartbeat();
  vi.useRealTimers();
});

describe('beatOnce', () => {
  it('upserts the single heartbeat row', async () => {
    await beatOnce();

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const values = mockDb.values.mock.calls[0][0];
    expect(values.id).toBe(1);
    expect(values.beatAt).toBeInstanceOf(Date);
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflict = mockDb.onConflictDoUpdate.mock.calls[0][0];
    expect(conflict.set.beatAt).toBeInstanceOf(Date);
  });

  it('never throws when the write fails — logs to console instead', async () => {
    mockDb.onConflictDoUpdate.mockImplementationOnce(() => {
      throw new Error('connection refused');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(beatOnce()).resolves.toBeUndefined();

    const logged = errSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('[heartbeat]');
    expect(logged).toContain('connection refused');
    errSpy.mockRestore();
  });
});

describe('startWorkerHeartbeat', () => {
  it('beats immediately and then every HEARTBEAT_INTERVAL_MS', async () => {
    vi.useFakeTimers();

    startWorkerHeartbeat();
    // immediate first beat
    await vi.advanceTimersByTimeAsync(0);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(mockDb.insert).toHaveBeenCalledTimes(3);
  });

  it('is idempotent — a second start does not double the timers', async () => {
    vi.useFakeTimers();

    startWorkerHeartbeat();
    startWorkerHeartbeat();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('stopWorkerHeartbeat stops the beats', async () => {
    vi.useFakeTimers();

    startWorkerHeartbeat();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);

    stopWorkerHeartbeat();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('a failing beat does not stop subsequent beats', async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDb.onConflictDoUpdate.mockImplementationOnce(() => {
      throw new Error('db briefly down');
    });

    startWorkerHeartbeat();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it('uses a ~60s interval', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(60_000);
  });
});
