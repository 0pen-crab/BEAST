import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

vi.mock('../orchestrator/entities.ts', () => ({
  findSessionByToken: vi.fn(async (token: string) =>
    token === 'valid-session-token'
      ? { userId: 1, username: 'admin', role: 'admin', displayName: null, mustChangePassword: false }
      : null),
}));

import { getWorkerStatus, pauseWorker, resumeWorker, isWorkerPaused, workerStatusRoutes } from './worker-status.ts';

function futureIso(ms = 60 * 60 * 1000): string {
  return new Date(Date.now() + ms).toISOString();
}

function pastIso(ms = 60 * 1000): string {
  return new Date(Date.now() - ms).toISOString();
}

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

  it('returns paused status after pauseWorker with a future resumesAt', () => {
    const resumesAt = futureIso();
    pauseWorker('rate_limit', resumesAt);
    const status = getWorkerStatus();
    expect(status.paused).toBe(true);
    expect(status.reason).toBe('rate_limit');
    expect(status.resumesAt).toBe(resumesAt);
    expect(isWorkerPaused()).toBe(true);
  });

  it('returns running status after resumeWorker', () => {
    pauseWorker('rate_limit', futureIso());
    resumeWorker();
    const status = getWorkerStatus();
    expect(status.paused).toBe(false);
  });

  it('updates pause info on subsequent pause calls', () => {
    const first = futureIso(60 * 60 * 1000);
    const second = futureIso(2 * 60 * 60 * 1000);
    pauseWorker('rate_limit', first);
    pauseWorker('rate_limit', second);
    const status = getWorkerStatus();
    expect(status.resumesAt).toBe(second);
  });

  it('stores pausedAt timestamp', () => {
    const before = new Date().toISOString();
    pauseWorker('rate_limit');
    const status = getWorkerStatus();
    expect(status.paused).toBe(true);
    expect(status.pausedAt).toBeDefined();
    expect(status.pausedAt! >= before).toBe(true);
  });

  // ── Auto-expiry of timed pauses ─────────────────────────────
  // A transient overload pause (resumesAt = now + 2min) must not stall the
  // queue for the 30-min Claude probe interval: once resumesAt passes, the
  // worker is no longer paused.

  it('auto-resumes when resumesAt is in the past (isWorkerPaused)', () => {
    pauseWorker('overloaded', pastIso());
    expect(isWorkerPaused()).toBe(false);
  });

  it('auto-resumes when resumesAt is in the past (getWorkerStatus) and clears state', () => {
    pauseWorker('overloaded', pastIso());
    const status = getWorkerStatus();
    expect(status.paused).toBe(false);
    expect(status.reason).toBeUndefined();
    expect(status.resumesAt).toBeUndefined();
    expect(status.pausedAt).toBeUndefined();
    // State is cleared, not just reported differently
    expect(isWorkerPaused()).toBe(false);
  });

  it('stays paused when resumesAt is in the future', () => {
    pauseWorker('rate_limit', futureIso());
    expect(isWorkerPaused()).toBe(true);
    expect(getWorkerStatus().paused).toBe(true);
  });

  it('stays paused when there is NO resumesAt (manual pause)', () => {
    pauseWorker('manual');
    expect(isWorkerPaused()).toBe(true);
    const status = getWorkerStatus();
    expect(status.paused).toBe(true);
    expect(status.reason).toBe('manual');
  });

  it('stays paused when resumesAt is not a parseable date', () => {
    pauseWorker('rate_limit', 'not-a-date');
    expect(isWorkerPaused()).toBe(true);
  });
});

// ── Routes: /worker/pause + /worker/resume auth ──────────────

describe('workerStatusRoutes', () => {
  let app: FastifyInstance;
  const TOKEN = 'test-internal-token';
  let prevToken: string | undefined;

  beforeAll(async () => {
    prevToken = process.env.INTERNAL_TOKEN;
    process.env.INTERNAL_TOKEN = TOKEN;
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(workerStatusRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (prevToken === undefined) delete process.env.INTERNAL_TOKEN;
    else process.env.INTERNAL_TOKEN = prevToken;
  });

  afterEach(() => {
    resumeWorker();
  });

  it('GET /worker-status returns the current status', async () => {
    pauseWorker('rate_limit', futureIso());
    const res = await app.inject({ method: 'GET', url: '/worker-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().paused).toBe(true);
  });

  it('POST /worker/pause rejects a missing/invalid internal token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/worker/pause',
      payload: { reason: 'rate_limit' },
    });
    expect(res.statusCode).toBe(401);
    expect(isWorkerPaused()).toBe(false);
  });

  it('POST /worker/pause accepts a valid internal token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/worker/pause',
      headers: { 'x-internal-token': TOKEN },
      payload: { reason: 'rate_limit', resumesAt: futureIso() },
    });
    expect(res.statusCode).toBe(200);
    expect(isWorkerPaused()).toBe(true);
  });

  it('POST /worker/resume rejects a missing internal token (does NOT unpause)', async () => {
    pauseWorker('rate_limit', futureIso());
    const res = await app.inject({ method: 'POST', url: '/worker/resume' });
    expect(res.statusCode).toBe(401);
    expect(isWorkerPaused()).toBe(true);
  });

  it('POST /worker/resume rejects an invalid internal token', async () => {
    pauseWorker('rate_limit', futureIso());
    const res = await app.inject({
      method: 'POST',
      url: '/worker/resume',
      headers: { 'x-internal-token': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(isWorkerPaused()).toBe(true);
  });

  it('POST /worker/resume accepts a valid internal token and unpauses', async () => {
    pauseWorker('rate_limit', futureIso());
    const res = await app.inject({
      method: 'POST',
      url: '/worker/resume',
      headers: { 'x-internal-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(isWorkerPaused()).toBe(false);
  });

  // The dashboard "Resume now" button authenticates with a user session, not
  // the internal token (the route is on the auth-middleware skip-list, so the
  // route validates the session itself).
  it('POST /worker/resume accepts a valid user session token and unpauses', async () => {
    pauseWorker('rate_limit', futureIso());
    const res = await app.inject({
      method: 'POST',
      url: '/worker/resume',
      headers: { authorization: 'Token valid-session-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(isWorkerPaused()).toBe(false);
  });

  it('POST /worker/resume rejects an invalid session token (does NOT unpause)', async () => {
    pauseWorker('rate_limit', futureIso());
    const res = await app.inject({
      method: 'POST',
      url: '/worker/resume',
      headers: { authorization: 'Token nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(isWorkerPaused()).toBe(true);
  });
});
