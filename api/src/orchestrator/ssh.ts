import { Client } from 'ssh2';
import fs from 'node:fs';
import { contextWindowForModel } from './ai-models.ts';

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

// ssh2's default `readyTimeout` is 20s. On a busy host (VM-on-laptop with
// load avg 10+, or right after a heavy verification scan that ran 35 min
// of Claude+curl), the handshake can take >20s — observed reliably. Bump
// the default to give the kernel a generous window before bailing.
const SSH_HANDSHAKE_TIMEOUT_MS = Number(process.env.SSH_HANDSHAKE_TIMEOUT_MS || 60_000);

function withDefaults(config: SSHConfig): SSHConfig & { readyTimeout: number } {
  return { ...config, readyTimeout: SSH_HANDSHAKE_TIMEOUT_MS };
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

export function sshWriteFile(config: SSHConfig, remotePath: string, data: string | Buffer, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('SFTP write aborted by cancellation'));
    }
    const conn = new Client();
    let settled = false;
    const onAbort = () => settle(() => { conn.end(); reject(new Error('SFTP write aborted by cancellation')); });
    // Settle exactly once and ALWAYS detach the abort listener — the signal is
    // scan-lifetime, so a leaked listener per call piles up into
    // MaxListenersExceededWarning on big scans.
    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn();
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) return settle(() => { conn.end(); reject(err); });
          const ws = sftp.createWriteStream(remotePath);
          ws.on('error', (e: Error) => settle(() => { conn.end(); reject(e); }));
          ws.on('close', () => settle(() => { conn.end(); resolve(); }));
          ws.end(data);
        });
      })
      .on('error', (err) => settle(() => reject(err)))
      .connect(withDefaults(config));
  });
}

export function sshReadFile(config: SSHConfig, remotePath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('SFTP read aborted by cancellation'));
    }
    const conn = new Client();
    let settled = false;
    const onAbort = () => settle(() => { conn.end(); reject(new Error('SFTP read aborted by cancellation')); });
    // Settle exactly once and ALWAYS detach the abort listener (see sshWriteFile).
    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn();
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) return settle(() => { conn.end(); reject(err); });
          const chunks: Buffer[] = [];
          const rs = sftp.createReadStream(remotePath);
          rs.on('data', (chunk: Buffer) => chunks.push(chunk));
          rs.on('error', (e: Error) => settle(() => { conn.end(); reject(e); }));
          rs.on('end', () => settle(() => { conn.end(); resolve(Buffer.concat(chunks).toString('utf-8')); }));
        });
      })
      .on('error', (err) => settle(() => reject(err)))
      .connect(withDefaults(config));
  });
}

export interface SSHExecOptions {
  /** Kill the connection if no stdout/stderr data arrives for this many ms */
  inactivityTimeoutMs?: number;
  /** Absolute max execution time in ms — hard kill regardless of activity */
  maxTimeoutMs?: number;
  /** Abort signal — when fired, kills the SSH session immediately */
  signal?: AbortSignal;
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

/**
 * Extract AiUsage from a stream-json result event.
 *
 * Claude Code sessions often invoke MULTIPLE models internally:
 *   - A small model (usually Haiku) for routing / cache orchestration
 *   - The requested main model (e.g. Opus 4.6 [1m]) for the actual inference
 *
 * `modelUsage` is keyed by model ID. We aggregate tokens across all models
 * (that's what actually went through the context window in total) and report
 * the model ID with the highest cost as the "primary" — that's the one
 * doing the real work.
 *
 * Previously we naively took `Object.keys(modelUsage)[0]`, which could pick
 * the cheap routing model (Haiku) even when the real work was done by Opus.
 */
export function extractAiUsage(result: Record<string, unknown>): import('./pipeline-types.ts').AiUsage | undefined {
  const modelUsage = result.modelUsage as Record<string, Record<string, unknown>> | undefined;
  if (!modelUsage) return undefined;
  const entries = Object.entries(modelUsage);
  if (entries.length === 0) return undefined;

  // Pick primary model: the one with the highest cost (the one doing real work).
  let primary = entries[0];
  for (const entry of entries) {
    const prevCost = (primary[1].costUSD as number) ?? 0;
    const currCost = (entry[1].costUSD as number) ?? 0;
    if (currCost > prevCost) primary = entry;
  }

  // Aggregate token counts across ALL models — this is what really traversed
  // the context window during the session, regardless of which model did what.
  let inputTokens = 0, outputTokens = 0, cacheReadInputTokens = 0, cacheCreationInputTokens = 0, costUSD = 0;
  for (const [, u] of entries) {
    inputTokens += (u.inputTokens as number) ?? 0;
    outputTokens += (u.outputTokens as number) ?? 0;
    cacheReadInputTokens += (u.cacheReadInputTokens as number) ?? 0;
    cacheCreationInputTokens += (u.cacheCreationInputTokens as number) ?? 0;
    costUSD += (u.costUSD as number) ?? 0;
  }

  return {
    model: primary[0],
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    costUSD,
  };
}

export interface AgentMetric {
  agent: string;
  model: string;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  totalContext: number;
  /** undefined when the model is not in the registry — never a guessed 200K */
  contextLimit: number | undefined;
  /** undefined when contextLimit is unknown (no lying metrics) */
  utilizationPct: number | undefined;
  costUSD: number;
  durationMs: number;
}

/**
 * Build a structured metric entry for one agent invocation.
 *
 * `totalContext` approximates the PEAK context window usage (what a status-line
 * plugin would show at the end of the session). The window grows monotonically
 * across turns as each tool call adds to the conversation:
 *
 *     peak_window ≈ cacheCreate + input + output
 *
 * - `cacheCreate` — tokens cached at session start (stay in window the whole time)
 * - `input`       — cumulative NEW non-cached tokens added via tool results / user messages
 * - `output`      — cumulative model responses (stay in window for subsequent turns)
 *
 * NOTE: `cacheRead` is deliberately excluded — it is a BILLING metric that
 * multiplies by turn count (reading the same cached prefix on every turn),
 * not a measure of how full the window is.
 *
 * `launchedModel` — the CLI --model value the wave was launched with. API
 * responses strip the '[1m]' suffix from `usage.model`, so without it a 1M
 * session would be measured against the 200K standard window (~5x
 * over-reported utilization). Pass it whenever it is in scope.
 */
export function buildAgentMetric(
  agent: string,
  usage: import('./pipeline-types.ts').AiUsage,
  durationMs: number,
  launchedModel?: string,
): AgentMetric {
  const totalContext = usage.cacheCreationInputTokens + usage.inputTokens + usage.outputTokens;
  const contextLimit = contextWindowForModel(usage.model, launchedModel);
  if (contextLimit === undefined) {
    console.warn(`[context] Unknown model ${usage.model} — add it to the model registry with its context window`);
  }
  const utilizationPct = contextLimit !== undefined && contextLimit > 0
    ? (totalContext / contextLimit) * 100
    : undefined;
  return {
    agent,
    model: usage.model,
    inputTokens: usage.inputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    outputTokens: usage.outputTokens,
    totalContext,
    contextLimit,
    utilizationPct,
    costUSD: usage.costUSD,
    durationMs,
  };
}

/** Format an AgentMetric as a single-line log entry. */
export function formatAgentMetric(m: AgentMetric, scanId?: string): string {
  const prefix = scanId ? `[${scanId}] ` : '';
  const ctxK = (m.totalContext / 1000).toFixed(1);
  // Unknown model (not in the registry): report honestly instead of a guessed limit.
  const limitStr = m.contextLimit !== undefined ? `${(m.contextLimit / 1000).toFixed(0)}K` : 'unknown';
  const utilStr = m.utilizationPct !== undefined ? `${m.utilizationPct.toFixed(1)}%` : 'n/a';
  const cost = m.costUSD.toFixed(4);
  const dur = (m.durationMs / 1000).toFixed(1);
  return `${prefix}agent=${m.agent} model=${m.model} ` +
    `input=${m.inputTokens} cacheRead=${m.cacheReadInputTokens} cacheCreate=${m.cacheCreationInputTokens} output=${m.outputTokens} ` +
    `totalContext=${ctxK}K limit=${limitStr} util=${utilStr} cost=$${cost} duration=${dur}s`;
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
    // Stream handle — populated once exec() returns. We need it in fail() to
    // SIGTERM the remote process before tearing the connection. Without this,
    // closing only the SSH channel leaves the remote command (claude / run-scans.sh)
    // running until it naturally completes.
    let activeStream: { signal: (sig: string) => void } | null = null;
    // Abort handler registered on the (scan-lifetime) cancel signal. MUST be
    // detached in cleanup(): the signal outlives this exec, and one leaked
    // listener per exec adds up to MaxListenersExceededWarning on big scans.
    let abortHandler: (() => void) | null = null;

    function cleanup() {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (abortHandler && options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
    }

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      // Best-effort: signal the remote process to terminate. ssh2 sends an SSH
      // signal-channel-request which OpenSSH translates to SIGTERM on the remote
      // command. Wrapped in try/catch because some servers reject signal requests.
      if (activeStream) {
        try { activeStream.signal('TERM'); } catch { /* ignore */ }
      }
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

    // Cancellation signal — when scan is cancelled, fail immediately and kill the connection
    if (options?.signal) {
      if (options.signal.aborted) {
        // Defer to next tick so connect() runs; otherwise fail() runs before promise is even returned
        setImmediate(() => fail(new Error('SSH command aborted by cancellation')));
      } else {
        abortHandler = () => fail(new Error('SSH command aborted by cancellation'));
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            fail(err);
            return;
          }
          activeStream = stream;
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
      .connect(withDefaults(config));
  });
}
