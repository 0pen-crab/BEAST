import { Client } from 'ssh2';
import fs from 'node:fs';

export interface SSHResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  privateKey: Buffer;
}

let privateKey: Buffer | null = null;

function loadKey(): Buffer {
  if (!privateKey) {
    const keyPath = process.env.SSH_KEY_PATH || '/app/keys/beast-scanner';
    privateKey = fs.readFileSync(keyPath);
  }
  return privateKey;
}

export function getClaudeRunnerConfig(): SSHConfig {
  return {
    host: process.env.CLAUDE_RUNNER_HOST || 'claude-runner',
    port: Number(process.env.CLAUDE_RUNNER_PORT || 22),
    username: 'scanner',
    privateKey: loadKey(),
  };
}

export function getSecurityToolsConfig(): SSHConfig {
  return {
    host: process.env.SECURITY_TOOLS_HOST || 'security-tools',
    port: Number(process.env.SECURITY_TOOLS_PORT || 22),
    username: 'scanner',
    privateKey: loadKey(),
  };
}

export function sshWriteFile(config: SSHConfig, remotePath: string, data: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return reject(err); }
          const ws = sftp.createWriteStream(remotePath);
          ws.on('error', (e: Error) => { conn.end(); reject(e); });
          ws.on('close', () => { conn.end(); resolve(); });
          ws.end(data);
        });
      })
      .on('error', reject)
      .connect(config);
  });
}

export function sshReadFile(config: SSHConfig, remotePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return reject(err); }
          const chunks: Buffer[] = [];
          const rs = sftp.createReadStream(remotePath);
          rs.on('data', (chunk: Buffer) => chunks.push(chunk));
          rs.on('error', (e: Error) => { conn.end(); reject(e); });
          rs.on('end', () => { conn.end(); resolve(Buffer.concat(chunks).toString('utf-8')); });
        });
      })
      .on('error', reject)
      .connect(config);
  });
}

export interface SSHExecOptions {
  /** Kill the connection if no stdout/stderr data arrives for this many ms */
  inactivityTimeoutMs?: number;
  /** Absolute max execution time in ms — hard kill regardless of activity */
  maxTimeoutMs?: number;
}

/**
 * Parse stream-json output from Claude Code.
 * Each line is a JSON event. The last "result" event contains the final output.
 * Returns the parsed result event and the raw log text.
 */
export function parseStreamJsonResult(stdout: string): {
  result: Record<string, unknown>;
  log: string;
} {
  const lines = stdout.trim().split('\n');

  // Find the result event (scan from end)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]);
      if (event.type === 'result') {
        return { result: event, log: stdout };
      }
    } catch {
      continue;
    }
  }

  // Fallback: try last line as plain JSON (backward compat)
  try {
    return { result: JSON.parse(lines[lines.length - 1]), log: stdout };
  } catch {
    return {
      result: { is_error: true, result: 'No result event found in stream output' },
      log: stdout,
    };
  }
}

/** Error with partial stdout/stderr captured before timeout */
export class SSHTimeoutError extends Error {
  stdout: string;
  stderr: string;
  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = 'SSHTimeoutError';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function sshExec(config: SSHConfig, command: string, options?: SSHExecOptions): Promise<SSHResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    function cleanup() {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (maxTimer) clearTimeout(maxTimer);
    }

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      conn.end();
      // Attach partial output so callers can save logs
      reject(new SSHTimeoutError(err.message, stdout, stderr));
    }

    function resetInactivityTimer() {
      if (!options?.inactivityTimeoutMs) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        const secs = Math.round(options.inactivityTimeoutMs! / 1000);
        fail(new Error(`SSH command timed out (no output for ${secs}s)`));
      }, options.inactivityTimeoutMs);
    }

    // Absolute timeout — hard kill regardless of activity
    if (options?.maxTimeoutMs) {
      maxTimer = setTimeout(() => {
        const mins = Math.round(options.maxTimeoutMs! / 60_000);
        fail(new Error(`SSH command exceeded max timeout (${mins}min)`));
      }, options.maxTimeoutMs);
    }

    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            fail(err);
            return;
          }
          resetInactivityTimer();
          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
            resetInactivityTimer();
            // stream-json: if we see a result event, resolve immediately
            // Claude Code keeps the process open after writing the result
            if (options?.inactivityTimeoutMs && stdout.includes('"type":"result"')) {
              if (!settled) {
                settled = true;
                cleanup();
                conn.end();
                resolve({ stdout, stderr, code: 0 });
              }
            }
          });
          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
            resetInactivityTimer();
          });
          stream.on('close', (code: number) => {
            if (settled) return;
            settled = true;
            cleanup();
            conn.end();
            resolve({ stdout, stderr, code: code ?? 0 });
          });
        });
      })
      .on('error', (err) => fail(err))
      .connect(config);
  });
}
