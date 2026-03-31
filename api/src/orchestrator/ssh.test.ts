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
  it('has correct function signature (config, remotePath, data) => Promise', async () => {
    const { sshWriteFile } = await import('./ssh.ts');
    expect(sshWriteFile.length).toBe(3);
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
});

// ── Type exports ────────────────────────────────────────────────────

describe('type exports', () => {
  it('module loads without errors (interfaces compile correctly)', async () => {
    const mod = await import('./ssh.ts');
    expect(mod).toBeDefined();
  });
});
