import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from './db/index.ts';
import { ForbiddenError } from './lib/authorize.ts';

const mockDb = db as any;

const mockCreateWorkspaceEvent = vi.fn();

vi.mock('./orchestrator/entities.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./orchestrator/entities.ts')>();
  return {
    ...actual,
    createWorkspaceEvent: (...args: unknown[]) => mockCreateWorkspaceEvent(...args),
  };
});

import { fatalCrashHandler, installCrashHandlers, apiErrorHandler } from './app.ts';

beforeEach(() => {
  vi.restoreAllMocks();
  mockCreateWorkspaceEvent.mockReset();
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

// ── Crash handlers ──────────────────────────────────────────────────

describe('fatalCrashHandler', () => {
  it('logs with a loud [FATAL] prefix and exits 1', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fatalCrashHandler('unhandledRejection')(new Error('stray rejection'));

    const logged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('[FATAL]');
    expect(logged).toContain('unhandledRejection');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs the full error including stack', () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = new Error('with-stack');
    fatalCrashHandler('uncaughtException')(err);

    // The Error object itself is passed to console.error (full stack visible)
    expect(errSpy.mock.calls.some(call => call.includes(err))).toBe(true);
  });
});

describe('installCrashHandlers', () => {
  it('registers unhandledRejection and uncaughtException handlers', () => {
    const onSpy = vi.spyOn(process, 'on');
    installCrashHandlers();

    const registered = onSpy.mock.calls.filter(
      (c) => c[0] === 'unhandledRejection' || c[0] === 'uncaughtException',
    );
    expect(registered.map((c) => c[0]).sort()).toEqual(['uncaughtException', 'unhandledRejection']);

    // Clean up: do not leave process.exit(1) handlers on the test process
    for (const [event, handler] of registered) {
      process.removeListener(event as string, handler as (...args: unknown[]) => void);
    }
  });
});

// ── Global API error handler ────────────────────────────────────────

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    url: '/api/something',
    query: {},
    params: {},
    body: undefined,
    user: { id: 3, username: 'tester', role: 'user' },
    log: { error: vi.fn() },
    ...overrides,
  } as any;
}

function makeReply() {
  const reply: any = {};
  reply.status = vi.fn(() => reply);
  reply.send = vi.fn(() => reply);
  return reply;
}

describe('apiErrorHandler', () => {
  it('returns 403 for ForbiddenError without writing an event', async () => {
    const reply = makeReply();
    await apiErrorHandler(new ForbiddenError('no access') as any, makeRequest(), reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'no access' });
    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
  });

  it('writes an api_error workspace event when workspace_id is in the query', async () => {
    const reply = makeReply();
    const request = makeRequest({ query: { workspace_id: '5' }, url: '/api/scans?workspace_id=5' });

    await apiErrorHandler(new Error('boom') as any, request, reply);

    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(5, 'api_error', expect.objectContaining({
      method: 'GET',
      url: '/api/scans?workspace_id=5',
      statusCode: 500,
      message: 'boom',
    }));
    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('attributes /api/workspaces/:id routes via the path param', async () => {
    const reply = makeReply();
    const request = makeRequest({ url: '/api/workspaces/12/members', params: { id: '12' } });

    await apiErrorHandler(new Error('boom') as any, request, reply);

    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(12, 'api_error', expect.objectContaining({ message: 'boom' }));
  });

  it('attributes /api/scans/:id routes by resolving the scan workspace from the DB', async () => {
    mockDb.where.mockResolvedValueOnce([{ workspaceId: 9 }]);
    const reply = makeReply();
    const request = makeRequest({
      url: '/api/scans/123e4567-e89b-12d3-a456-426614174000/steps',
      params: { id: '123e4567-e89b-12d3-a456-426614174000' },
    });

    await apiErrorHandler(new Error('scan boom') as any, request, reply);

    expect(mockDb.select).toHaveBeenCalled();
    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(9, 'api_error', expect.objectContaining({ message: 'scan boom' }));
  });

  it('logs a loud structured line when the error cannot be attributed to a workspace', async () => {
    const reply = makeReply();
    const request = makeRequest({ url: '/api/contributors/44', params: { id: '44' } });

    await apiErrorHandler(new Error('orphan error') as any, request, reply);

    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(request.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/api/contributors/44',
        statusCode: 500,
        userId: 3,
      }),
      expect.stringContaining('orphan error'),
    );
    // Still responds with the error payload
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ message: 'orphan error' }));
  });

  it('respects the error statusCode', async () => {
    const reply = makeReply();
    const err: any = new Error('not found');
    err.statusCode = 404;

    await apiErrorHandler(err, makeRequest(), reply);

    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('still responds when writing the workspace event fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateWorkspaceEvent.mockRejectedValueOnce(new Error('db down'));
    const reply = makeReply();
    const request = makeRequest({ query: { workspace_id: '5' } });

    await apiErrorHandler(new Error('boom') as any, request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(consoleSpy.mock.calls.flat().map(String).join(' ')).toContain('db down');
  });

  it('does not attribute a scan error when the DB lookup fails (best-effort only)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDb.where.mockRejectedValueOnce(new Error('db offline'));
    const reply = makeReply();
    const request = makeRequest({
      url: '/api/scans/123e4567-e89b-12d3-a456-426614174000',
      params: { id: '123e4567-e89b-12d3-a456-426614174000' },
    });

    await apiErrorHandler(new Error('boom') as any, request, reply);

    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(consoleSpy.mock.calls.flat().map(String).join(' ')).toContain('db offline');
  });
});
