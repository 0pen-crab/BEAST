import { describe, it, expect, vi, beforeEach } from 'vitest';

// Next-instance behavior — set before each test
let nextBehavior: 'ok' | 'not-logged-in' | 'conn-error' = 'ok';
let nextStdout = '';
let connectCount = 0;

vi.mock('ssh2', () => {
  function MockClient(this: any) {
    const handlers: Record<string, Function> = {};
    this.on = function(event: string, cb: Function) { handlers[event] = cb; return this; };
    this.connect = function() {
      connectCount++;
      if (nextBehavior === 'conn-error') {
        setTimeout(() => handlers['error']?.(new Error('ECONNREFUSED')), 0);
      } else {
        setTimeout(() => handlers['ready']?.(), 0);
      }
    };
    this.exec = function(_cmd: string, cb: Function) {
      const sh: Record<string, Function> = {};
      const stream = {
        on(e: string, h: Function) { sh[e] = h; return stream; },
        stderr: { on() { return this; } },
      };
      cb(null, stream);
      setTimeout(() => { sh['data']?.(Buffer.from(nextStdout)); sh['close']?.(0); }, 0);
    };
    this.end = function() {};
  }
  return { Client: MockClient };
});

vi.mock('../orchestrator/ssh.ts', () => ({
  getClaudeRunnerConfig: () => ({
    host: 'claude-runner', port: 22, username: 'scanner',
    privateKey: Buffer.from('fake'),
  }),
}));

const { checkClaudeStatus, clearClaudeStatusCache } = await import('./claude-status.ts');

describe('checkClaudeStatus', () => {
  beforeEach(() => {
    clearClaudeStatusCache();
    connectCount = 0;
  });

  it('returns authenticated when Claude responds', async () => {
    nextBehavior = 'ok';
    nextStdout = '{"type":"result","result":"hi"}';
    const result = await checkClaudeStatus();
    expect(result.status).toBe('authenticated');
  });

  it('returns not_authenticated when "Not logged in"', async () => {
    nextBehavior = 'ok';
    nextStdout = 'Not logged in to Claude';
    const result = await checkClaudeStatus();
    expect(result.status).toBe('not_authenticated');
  });

  it('returns unreachable on SSH connection error', async () => {
    nextBehavior = 'conn-error';
    const result = await checkClaudeStatus();
    expect(result.status).toBe('unreachable');
    expect(result.message).toBe('ECONNREFUSED');
  });

  it('caches result for subsequent calls', async () => {
    nextBehavior = 'ok';
    nextStdout = '{"type":"result"}';
    await checkClaudeStatus();
    await checkClaudeStatus();
    expect(connectCount).toBe(1);
  });
});
