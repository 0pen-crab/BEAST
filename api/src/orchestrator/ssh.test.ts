import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs.readFileSync for loadKey
vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue(Buffer.from('fake-private-key')),
  },
}));

// Configurable behavior for the SSH mock. Tests set these before calling
// sshExec/sshWriteFile, and the mock Client reads them during execution.
let sshBehavior: {
  mode: 'ready' | 'error';
  errorMessage?: string;
  execImpl?: (cmd: string, cb: (err: Error | null, stream: unknown) => void) => void;
  sftpImpl?: (cb: (err: Error | null, sftp: unknown) => void) => void;
};

let lastMockEnd: ReturnType<typeof vi.fn>;

vi.mock('ssh2', () => {
  function Client(this: Record<string, unknown>) {
    const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
    const endFn = vi.fn();
    lastMockEnd = endFn;

    this.end = endFn;

    this.exec = function (cmd: string, cb: (err: Error | null, stream: unknown) => void) {
      if (sshBehavior.execImpl) {
        sshBehavior.execImpl(cmd, cb);
      }
    };

    this.sftp = function (cb: (err: Error | null, sftp: unknown) => void) {
      if (sshBehavior.sftpImpl) {
        sshBehavior.sftpImpl(cb);
      }
    };

    const self = this;
    this.on = function (event: string, cb: (...args: unknown[]) => void) {
      eventHandlers[event] = cb;
      return self;
    };

    this.connect = function () {
      if (sshBehavior.mode === 'error') {
        setTimeout(() => eventHandlers['error']?.(new Error(sshBehavior.errorMessage || 'SSH error')), 0);
      } else {
        setTimeout(() => eventHandlers['ready']?.(), 0);
      }
      return self;
    };
  }
  return { Client };
});

beforeEach(() => {
  vi.clearAllMocks();
  sshBehavior = { mode: 'ready' };
});

// ── Module exports ──────────────────────────────────────────────────

describe('ssh module exports', () => {
  it('exports sshExec function', async () => {
    const mod = await import('./ssh.ts');
    expect(typeof mod.sshExec).toBe('function');
  });

  it('exports sshWriteFile function', async () => {
    const mod = await import('./ssh.ts');
    expect(typeof mod.sshWriteFile).toBe('function');
  });

  it('exports getClaudeRunnerConfig function', async () => {
    const mod = await import('./ssh.ts');
    expect(typeof mod.getClaudeRunnerConfig).toBe('function');
  });

  it('exports getSecurityToolsConfig function', async () => {
    const mod = await import('./ssh.ts');
    expect(typeof mod.getSecurityToolsConfig).toBe('function');
  });
});

// ── SSH Config functions ────────────────────────────────────────────

describe('getClaudeRunnerConfig', () => {
  it('returns config with host, port, username, and privateKey', async () => {
    const { getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    expect(config).toHaveProperty('host');
    expect(config).toHaveProperty('port');
    expect(config).toHaveProperty('username', 'scanner');
    expect(config).toHaveProperty('privateKey');
    expect(Buffer.isBuffer(config.privateKey)).toBe(true);
  });

  it('defaults host to claude-runner', async () => {
    const { getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();
    expect(config.host).toBe('claude-runner');
  });

  it('defaults port to 22', async () => {
    const { getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();
    expect(config.port).toBe(22);
  });
});

describe('getSecurityToolsConfig', () => {
  it('returns config with host, port, username, and privateKey', async () => {
    const { getSecurityToolsConfig } = await import('./ssh.ts');
    const config = getSecurityToolsConfig();

    expect(config).toHaveProperty('host');
    expect(config).toHaveProperty('port');
    expect(config).toHaveProperty('username', 'scanner');
    expect(config).toHaveProperty('privateKey');
    expect(Buffer.isBuffer(config.privateKey)).toBe(true);
  });

  it('defaults host to security-tools', async () => {
    const { getSecurityToolsConfig } = await import('./ssh.ts');
    const config = getSecurityToolsConfig();
    expect(config.host).toBe('security-tools');
  });

  it('defaults port to 22', async () => {
    const { getSecurityToolsConfig } = await import('./ssh.ts');
    const config = getSecurityToolsConfig();
    expect(config.port).toBe(22);
  });
});

// ── sshExec ─────────────────────────────────────────────────────────

describe('sshExec', () => {
  it('accepts an optional options parameter', async () => {
    const { sshExec } = await import('./ssh.ts');
    // sshExec(config, command, options?) — 2 required params
    expect(sshExec.length).toBeGreaterThanOrEqual(2);
  });

  it('connects to SSH and resolves with stdout/stderr/code on success', async () => {
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    sshBehavior.mode = 'ready';
    sshBehavior.execImpl = (_cmd, cb) => {
      const streamEvents: Record<string, (...args: unknown[]) => void> = {};
      const stderrEvents: Record<string, (...args: unknown[]) => void> = {};
      const stream = {
        on(evt: string, handler: (...args: unknown[]) => void) {
          streamEvents[evt] = handler;
          return stream;
        },
        stderr: {
          on(evt: string, handler: (...args: unknown[]) => void) {
            stderrEvents[evt] = handler;
            return stream.stderr;
          },
        },
      };
      cb(null, stream);
      streamEvents['data'](Buffer.from('hello'));
      stderrEvents['data'](Buffer.from('warning'));
      streamEvents['close'](0);
    };

    const result = await sshExec(config, 'echo hello');

    expect(result).toEqual({ stdout: 'hello', stderr: 'warning', code: 0 });
    expect(lastMockEnd).toHaveBeenCalled();
  });

  it('rejects when connection error occurs', async () => {
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    sshBehavior.mode = 'error';
    sshBehavior.errorMessage = 'Connection refused';

    await expect(sshExec(config, 'ls')).rejects.toThrow('Connection refused');
  });

  it('rejects when exec returns an error', async () => {
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    sshBehavior.mode = 'ready';
    sshBehavior.execImpl = (_cmd, cb) => {
      cb(new Error('exec failed'), null);
    };

    await expect(sshExec(config, 'bad-command')).rejects.toThrow('exec failed');
    expect(lastMockEnd).toHaveBeenCalled();
  });

  it('rejects with timeout error when no data arrives within inactivityTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
      const config = getClaudeRunnerConfig();

      sshBehavior.mode = 'ready';
      sshBehavior.execImpl = (_cmd, cb) => {
        const streamEvents: Record<string, (...args: unknown[]) => void> = {};
        const stderrEvents: Record<string, (...args: unknown[]) => void> = {};
        const stream = {
          on(evt: string, handler: (...args: unknown[]) => void) {
            streamEvents[evt] = handler;
            return stream;
          },
          stderr: {
            on(evt: string, handler: (...args: unknown[]) => void) {
              stderrEvents[evt] = handler;
              return stream.stderr;
            },
          },
        };
        cb(null, stream);
        // No data arrives — simulate a stuck process
      };

      const promise = sshExec(config, 'stuck-command', { inactivityTimeoutMs: 5000 });

      // Catch the rejection immediately to prevent unhandled rejection leak
      const caught = promise.catch((e: Error) => e);

      await vi.advanceTimersByTimeAsync(5001);

      const err = await caught as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('SSH command timed out (no output for 5s)');
      expect(lastMockEnd).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets inactivity timer when stderr data arrives', async () => {
    vi.useFakeTimers();
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    let streamEvents: Record<string, (...args: unknown[]) => void> = {};
    let stderrEvents: Record<string, (...args: unknown[]) => void> = {};

    sshBehavior.mode = 'ready';
    sshBehavior.execImpl = (_cmd, cb) => {
      streamEvents = {};
      stderrEvents = {};
      const stream = {
        on(evt: string, handler: (...args: unknown[]) => void) {
          streamEvents[evt] = handler;
          return stream;
        },
        stderr: {
          on(evt: string, handler: (...args: unknown[]) => void) {
            stderrEvents[evt] = handler;
            return stream.stderr;
          },
        },
      };
      cb(null, stream);
    };

    const promise = sshExec(config, 'long-command', { inactivityTimeoutMs: 5000 });

    // Advance 4s — no timeout yet
    await vi.advanceTimersByTimeAsync(4000);
    // stderr data arrives — resets the timer
    stderrEvents['data'](Buffer.from('progress'));
    // Advance another 4s — still within 5s since last data
    await vi.advanceTimersByTimeAsync(4000);
    // Close the stream — process finishes
    streamEvents['data'](Buffer.from('result'));
    streamEvents['close'](0);

    const result = await promise;
    expect(result.stdout).toBe('result');
    expect(result.stderr).toBe('progress');

    vi.useRealTimers();
  });

  it('rejects with max timeout error even when data keeps arriving', async () => {
    vi.useFakeTimers();
    try {
      const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
      const config = getClaudeRunnerConfig();

      let stderrEmit: (data: Buffer) => void = () => {};

      sshBehavior.mode = 'ready';
      sshBehavior.execImpl = (_cmd, cb) => {
        const streamEvents: Record<string, (...args: unknown[]) => void> = {};
        const stream = {
          on(evt: string, handler: (...args: unknown[]) => void) {
            streamEvents[evt] = handler;
            return stream;
          },
          stderr: {
            on(evt: string, handler: (...args: unknown[]) => void) {
              if (evt === 'data') stderrEmit = handler as (data: Buffer) => void;
              return stream.stderr;
            },
          },
        };
        cb(null, stream);
      };

      const promise = sshExec(config, 'long-command', {
        inactivityTimeoutMs: 5000,
        maxTimeoutMs: 10_000,
      });
      const caught = promise.catch((e: Error) => e);

      // Keep feeding data every 3s — inactivity never fires
      await vi.advanceTimersByTimeAsync(3000);
      stderrEmit(Buffer.from('progress1'));
      await vi.advanceTimersByTimeAsync(3000);
      stderrEmit(Buffer.from('progress2'));
      await vi.advanceTimersByTimeAsync(3000);
      stderrEmit(Buffer.from('progress3'));
      // Now at ~9s, advance past 10s max
      await vi.advanceTimersByTimeAsync(2000);

      const err = await caught as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('exceeded max timeout');
      expect(lastMockEnd).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when SSH connection drops mid-execution', async () => {
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    sshBehavior.mode = 'ready';
    sshBehavior.execImpl = (_cmd, cb) => {
      const streamEvents: Record<string, (...args: unknown[]) => void> = {};
      const stream = {
        on(evt: string, handler: (...args: unknown[]) => void) {
          streamEvents[evt] = handler;
          return stream;
        },
        stderr: {
          on(evt: string, handler: (...args: unknown[]) => void) {
            return stream.stderr;
          },
        },
      };
      cb(null, stream);
      // Stream some data then close with error code
      streamEvents['data'](Buffer.from('partial'));
      streamEvents['close'](255);
    };

    const result = await sshExec(config, 'crashing-command');
    expect(result.code).toBe(255);
    expect(result.stdout).toBe('partial');
  });

  it('removes its abort listener from the scan-lifetime signal on normal completion', async () => {
    // The cancelSignal lives for the WHOLE scan while each sshExec is one of
    // hundreds — a listener leaked per exec piles up into
    // MaxListenersExceededWarning spam on big scans.
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    sshBehavior.mode = 'ready';
    sshBehavior.execImpl = (_cmd, cb) => {
      const streamEvents: Record<string, (...args: unknown[]) => void> = {};
      const stream = {
        on(evt: string, handler: (...args: unknown[]) => void) {
          streamEvents[evt] = handler;
          return stream;
        },
        stderr: { on() { return stream.stderr; } },
      };
      cb(null, stream);
      streamEvents['data'](Buffer.from('done'));
      streamEvents['close'](0);
    };

    const result = await sshExec(config, 'echo done', { signal: controller.signal });

    expect(result.stdout).toBe('done');
    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes its abort listener when the exec fails, too', async () => {
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    sshBehavior.mode = 'ready';
    sshBehavior.execImpl = (_cmd, cb) => {
      cb(new Error('exec failed'), null);
    };

    await expect(sshExec(config, 'bad', { signal: controller.signal })).rejects.toThrow('exec failed');
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('still aborts in-flight commands when the signal fires', async () => {
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();
    const controller = new AbortController();

    sshBehavior.mode = 'ready';
    sshBehavior.execImpl = (_cmd, cb) => {
      const stream = {
        on() { return stream; },
        stderr: { on() { return stream.stderr; } },
        signal: vi.fn(),
      };
      cb(null, stream);
      // Never closes — simulates a long-running remote command
    };

    const promise = sshExec(config, 'sleep 999', { signal: controller.signal });
    const caught = promise.catch((e: Error) => e);
    await new Promise(r => setTimeout(r, 5));
    controller.abort();

    const err = await caught as Error;
    expect(err.message).toContain('SSH command aborted by cancellation');
    expect(lastMockEnd).toHaveBeenCalled();
  });

  it('does not apply timeout when inactivityTimeoutMs is not set', async () => {
    const { sshExec, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    sshBehavior.mode = 'ready';
    sshBehavior.execImpl = (_cmd, cb) => {
      const streamEvents: Record<string, (...args: unknown[]) => void> = {};
      const stream = {
        on(evt: string, handler: (...args: unknown[]) => void) {
          streamEvents[evt] = handler;
          return stream;
        },
        stderr: {
          on(evt: string, handler: (...args: unknown[]) => void) {
            return stream.stderr;
          },
        },
      };
      cb(null, stream);
      // Complete immediately
      streamEvents['data'](Buffer.from('done'));
      streamEvents['close'](0);
    };

    const result = await sshExec(config, 'quick-command');
    expect(result.stdout).toBe('done');
  });
});

// ── sshWriteFile ────────────────────────────────────────────────────

describe('sshWriteFile', () => {
  it('has correct function signature (config, remotePath, data, signal?) => Promise', async () => {
    const { sshWriteFile } = await import('./ssh.ts');
    expect(sshWriteFile.length).toBe(4);
  });

  it('connects to SSH and writes file via SFTP on success', async () => {
    const { sshWriteFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    const mockWriteStreamEnd = vi.fn();

    sshBehavior.mode = 'ready';
    sshBehavior.sftpImpl = (cb) => {
      const writeStreamEvents: Record<string, (...args: unknown[]) => void> = {};
      const mockWriteStream = {
        on(evt: string, handler: (...args: unknown[]) => void) {
          writeStreamEvents[evt] = handler;
          return mockWriteStream;
        },
        end: mockWriteStreamEnd.mockImplementation(() => {
          setTimeout(() => writeStreamEvents['close']?.(), 0);
        }),
      };
      cb(null, {
        createWriteStream: vi.fn().mockReturnValue(mockWriteStream),
      });
    };

    await sshWriteFile(config, '/tmp/test.txt', Buffer.from('data'));

    expect(mockWriteStreamEnd).toHaveBeenCalledWith(Buffer.from('data'));
    expect(lastMockEnd).toHaveBeenCalled();
  });

  it('rejects when SFTP errors', async () => {
    const { sshWriteFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    const config = getClaudeRunnerConfig();

    sshBehavior.mode = 'ready';
    sshBehavior.sftpImpl = (cb) => {
      cb(new Error('SFTP failed'), null);
    };

    await expect(
      sshWriteFile(config, '/tmp/test.txt', Buffer.from('data')),
    ).rejects.toThrow('SFTP failed');
    expect(lastMockEnd).toHaveBeenCalled();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { sshWriteFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    const controller = new AbortController();
    controller.abort();

    sshBehavior.mode = 'ready';
    sshBehavior.sftpImpl = () => { throw new Error('must not reach SFTP'); };

    await expect(
      sshWriteFile(getClaudeRunnerConfig(), '/tmp/test.txt', 'data', controller.signal),
    ).rejects.toThrow('SFTP write aborted by cancellation');
  });

  it('rejects and tears down the connection when aborted mid-write', async () => {
    const { sshWriteFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    const controller = new AbortController();

    sshBehavior.mode = 'ready';
    sshBehavior.sftpImpl = (cb) => {
      // Write stream that never completes — simulates a hung SFTP transfer
      const mockWriteStream = {
        on() { return mockWriteStream; },
        end() {},
      };
      cb(null, { createWriteStream: vi.fn().mockReturnValue(mockWriteStream) });
    };

    const promise = sshWriteFile(getClaudeRunnerConfig(), '/tmp/test.txt', 'data', controller.signal);
    const caught = promise.catch((e: Error) => e);
    // Let the connection reach 'ready'
    await new Promise(r => setTimeout(r, 5));
    controller.abort();

    const err = await caught as Error;
    expect(err.message).toContain('SFTP write aborted by cancellation');
    expect(lastMockEnd).toHaveBeenCalled();
  });

  it('removes its abort listener from the scan-lifetime signal on completion', async () => {
    const { sshWriteFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    sshBehavior.mode = 'ready';
    sshBehavior.sftpImpl = (cb) => {
      const writeStreamEvents: Record<string, (...args: unknown[]) => void> = {};
      const mockWriteStream = {
        on(evt: string, handler: (...args: unknown[]) => void) {
          writeStreamEvents[evt] = handler;
          return mockWriteStream;
        },
        end() { setTimeout(() => writeStreamEvents['close']?.(), 0); },
      };
      cb(null, { createWriteStream: vi.fn().mockReturnValue(mockWriteStream) });
    };

    await sshWriteFile(getClaudeRunnerConfig(), '/tmp/test.txt', 'data', controller.signal);

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

// ── sshReadFile ─────────────────────────────────────────────────────

describe('sshReadFile', () => {
  function readableSftp(content: string) {
    return (cb: (err: Error | null, sftp: unknown) => void) => {
      const rsEvents: Record<string, (...args: unknown[]) => void> = {};
      const rs = {
        on(evt: string, handler: (...args: unknown[]) => void) {
          rsEvents[evt] = handler;
          if (evt === 'end') {
            setTimeout(() => {
              rsEvents['data']?.(Buffer.from(content));
              rsEvents['end']?.();
            }, 0);
          }
          return rs;
        },
      };
      cb(null, { createReadStream: vi.fn().mockReturnValue(rs) });
    };
  }

  it('reads file content via SFTP', async () => {
    const { sshReadFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    sshBehavior.mode = 'ready';
    sshBehavior.sftpImpl = readableSftp('file body');

    const content = await sshReadFile(getClaudeRunnerConfig(), '/tmp/file.txt');
    expect(content).toBe('file body');
    expect(lastMockEnd).toHaveBeenCalled();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { sshReadFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    const controller = new AbortController();
    controller.abort();

    await expect(
      sshReadFile(getClaudeRunnerConfig(), '/tmp/file.txt', controller.signal),
    ).rejects.toThrow('SFTP read aborted by cancellation');
  });

  it('rejects and tears down the connection when aborted mid-read', async () => {
    const { sshReadFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    const controller = new AbortController();

    sshBehavior.mode = 'ready';
    sshBehavior.sftpImpl = (cb) => {
      // Read stream that never emits — simulates a hung transfer
      const rs = { on() { return rs; } };
      cb(null, { createReadStream: vi.fn().mockReturnValue(rs) });
    };

    const promise = sshReadFile(getClaudeRunnerConfig(), '/tmp/file.txt', controller.signal);
    const caught = promise.catch((e: Error) => e);
    await new Promise(r => setTimeout(r, 5));
    controller.abort();

    const err = await caught as Error;
    expect(err.message).toContain('SFTP read aborted by cancellation');
    expect(lastMockEnd).toHaveBeenCalled();
  });

  it('removes its abort listener from the scan-lifetime signal on completion', async () => {
    const { sshReadFile, getClaudeRunnerConfig } = await import('./ssh.ts');
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    sshBehavior.mode = 'ready';
    sshBehavior.sftpImpl = readableSftp('ok');

    await sshReadFile(getClaudeRunnerConfig(), '/tmp/file.txt', controller.signal);

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

// ── extractAiUsage ────────────────────────────────────────────────────

describe('extractAiUsage', () => {
  it('returns undefined when no modelUsage', async () => {
    const { extractAiUsage } = await import('./ssh.ts');
    expect(extractAiUsage({})).toBeUndefined();
    expect(extractAiUsage({ modelUsage: {} })).toBeUndefined();
  });

  it('picks the primary model by highest cost and sums tokens across all models', async () => {
    const { extractAiUsage } = await import('./ssh.ts');
    // Real-world shape: Haiku used for routing (cheap), Opus does main work (expensive)
    const usage = extractAiUsage({
      modelUsage: {
        'claude-haiku-4-5-20251001': {
          inputTokens: 344, outputTokens: 12,
          cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
          costUSD: 0.0004,
        },
        'claude-opus-4-6': {
          inputTokens: 2, outputTokens: 4,
          cacheReadInputTokens: 11809, cacheCreationInputTokens: 5193,
          costUSD: 0.0385,
        },
      },
    });
    // Primary = the expensive one (Opus did the work)
    expect(usage?.model).toBe('claude-opus-4-6');
    // Aggregated tokens = sum across all models
    expect(usage?.inputTokens).toBe(346);
    expect(usage?.outputTokens).toBe(16);
    expect(usage?.cacheReadInputTokens).toBe(11809);
    expect(usage?.cacheCreationInputTokens).toBe(5193);
    expect(usage?.costUSD).toBeCloseTo(0.0389, 4);
  });

  it('works with single-model usage (backward-compat)', async () => {
    const { extractAiUsage } = await import('./ssh.ts');
    const usage = extractAiUsage({
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 100, outputTokens: 50,
          cacheReadInputTokens: 1000, cacheCreationInputTokens: 500,
          costUSD: 0.01,
        },
      },
    });
    expect(usage?.model).toBe('claude-sonnet-4-6');
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.cacheReadInputTokens).toBe(1000);
  });
});

// ── Context window tracking helpers ──────────────────────────────────

describe('buildAgentMetric', () => {
  it('computes peak window as cacheCreate + input + output (excludes cacheRead billing metric)', async () => {
    const { buildAgentMetric } = await import('./ssh.ts');
    const m = buildAgentMetric('recon', {
      model: 'claude-sonnet-4-6',
      inputTokens: 10_000,
      outputTokens: 2_000,
      cacheReadInputTokens: 50_000,  // deliberately excluded — multiplies by turn count
      cacheCreationInputTokens: 30_000,
      costUSD: 0.42,
    }, 45_000);

    expect(m.agent).toBe('recon');
    // peak window = cacheCreate(30K) + input(10K) + output(2K) = 42K
    expect(m.totalContext).toBe(42_000);
    expect(m.contextLimit).toBe(200_000);
    expect(m.utilizationPct).toBeCloseTo(21, 1);
    expect(m.costUSD).toBe(0.42);
    expect(m.durationMs).toBe(45_000);
  });

  it('handles 1M context models', async () => {
    const { buildAgentMetric } = await import('./ssh.ts');
    const m = buildAgentMetric('sniper:auth', {
      model: 'claude-opus-4-6[1m]',
      inputTokens: 100_000,
      outputTokens: 5_000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 1.5,
    }, 60_000);

    expect(m.contextLimit).toBe(1_000_000);
    // peak window = 0 + 100K + 5K = 105K
    expect(m.totalContext).toBe(105_000);
    expect(m.utilizationPct).toBeCloseTo(10.5, 1);
  });

  it('uses the 1M window when the wave was launched as a [1m] variant but the API reports the plain id', async () => {
    const { buildAgentMetric } = await import('./ssh.ts');
    // API modelUsage keys never carry the CLI '[1m]' suffix — before the registry
    // fix this was computed against 200K and over-reported utilization ~5x.
    const m = buildAgentMetric('analyzer', {
      model: 'claude-sonnet-5',
      inputTokens: 100_000,
      outputTokens: 5_000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 1.0,
    }, 60_000, 'claude-sonnet-5[1m]');

    expect(m.contextLimit).toBe(1_000_000);
    expect(m.utilizationPct).toBeCloseTo(10.5, 1);
  });

  it('handles date-suffixed API ids with a launched [1m] model', async () => {
    const { buildAgentMetric } = await import('./ssh.ts');
    const m = buildAgentMetric('sniper:core', {
      model: 'claude-opus-4-6-20261101',
      inputTokens: 200_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 2.0,
    }, 60_000, 'claude-opus-4-6[1m]');

    expect(m.contextLimit).toBe(1_000_000);
    expect(m.utilizationPct).toBeCloseTo(20, 1);
  });

  it('warns loudly and skips utilization for unknown models (no lying 200K default)', async () => {
    const { buildAgentMetric } = await import('./ssh.ts');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const m = buildAgentMetric('recon', {
        model: 'claude-mystery-9',
        inputTokens: 10_000,
        outputTokens: 1_000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 5_000,
        costUSD: 0.1,
      }, 5_000);

      expect(m.contextLimit).toBeUndefined();
      expect(m.utilizationPct).toBeUndefined();
      // token accounting still works — only the utilization metric is skipped
      expect(m.totalContext).toBe(16_000);
      expect(warnSpy).toHaveBeenCalledWith(
        '[context] Unknown model claude-mystery-9 — add it to the model registry with its context window',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('formatAgentMetric', () => {
  it('produces a one-line log entry', async () => {
    const { formatAgentMetric, buildAgentMetric } = await import('./ssh.ts');
    const m = buildAgentMetric('scout:api', {
      model: 'claude-sonnet-4-6',
      inputTokens: 5_000, outputTokens: 1_000,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05,
    }, 10_000);

    const line = formatAgentMetric(m, 'scan-123');
    expect(line).toContain('[scan-123]');
    expect(line).toContain('agent=scout:api');
    expect(line).toContain('model=claude-sonnet-4-6');
    expect(line).toContain('util=');
    expect(line).toContain('cost=$0.0500');
    expect(line).not.toContain('\n');
  });

  it('omits scanId prefix when not provided', async () => {
    const { formatAgentMetric, buildAgentMetric } = await import('./ssh.ts');
    const m = buildAgentMetric('recon', {
      model: 'claude-sonnet-4-6',
      inputTokens: 100, outputTokens: 10,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.001,
    }, 1000);
    const line = formatAgentMetric(m);
    expect(line.startsWith('agent=')).toBe(true);
  });
});

// ── Type exports ────────────────────────────────────────────────────

describe('type exports', () => {
  it('module loads without errors (interfaces compile correctly)', async () => {
    const mod = await import('./ssh.ts');
    expect(mod).toBeDefined();
  });
});
