import { describe, it, expect, beforeEach } from 'vitest';
import { getWorkerStatus, pauseWorker, resumeWorker } from './worker-status.ts';

describe('worker-status', () => {
  beforeEach(() => {
    resumeWorker();
  });

  it('returns running status by default', () => {
    const status = getWorkerStatus();
    expect(status.paused).toBe(false);
    expect(status.reason).toBeUndefined();
    expect(status.resumesAt).toBeUndefined();
  });

  it('returns paused status after pauseWorker', () => {
    pauseWorker('rate_limit', '2026-04-07T22:00:00Z');
    const status = getWorkerStatus();
    expect(status.paused).toBe(true);
    expect(status.reason).toBe('rate_limit');
    expect(status.resumesAt).toBe('2026-04-07T22:00:00Z');
  });

  it('returns running status after resumeWorker', () => {
    pauseWorker('rate_limit', '2026-04-07T22:00:00Z');
    resumeWorker();
    const status = getWorkerStatus();
    expect(status.paused).toBe(false);
  });

  it('updates pause info on subsequent pause calls', () => {
    pauseWorker('rate_limit', '2026-04-07T22:00:00Z');
    pauseWorker('rate_limit', '2026-04-07T23:00:00Z');
    const status = getWorkerStatus();
    expect(status.resumesAt).toBe('2026-04-07T23:00:00Z');
  });

  it('stores pausedAt timestamp', () => {
    const before = new Date().toISOString();
    pauseWorker('rate_limit');
    const status = getWorkerStatus();
    expect(status.paused).toBe(true);
    expect(status.pausedAt).toBeDefined();
    expect(status.pausedAt! >= before).toBe(true);
  });
});
