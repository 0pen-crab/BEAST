import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Client } from 'ssh2';
import { getClaudeRunnerConfig } from '../orchestrator/ssh.ts';

export type ClaudeStatus = 'authenticated' | 'not_authenticated' | 'unreachable';

export interface ClaudeStatusResponse {
  status: ClaudeStatus;
  message?: string;
}

let cachedResult: { status: ClaudeStatus; message?: string; timestamp: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/** Clear cached result (for tests) */
export function clearClaudeStatusCache(): void {
  cachedResult = null;
}

/**
 * SSH to claude-runner, ask Claude "hi", see if it responds.
 * 5s connection timeout, 15s command timeout.
 */
export function runQuickClaudeCheck(): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const config = getClaudeRunnerConfig();
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const maxTimer = setTimeout(() => {
      if (!settled) { settled = true; conn.end(); reject(new Error('Timeout')); }
    }, 15_000);

    conn
      .on('ready', () => {
        conn.exec('echo "hi" | claude -p --max-turns 1 --output-format stream-json', (err, stream) => {
          if (err) { settled = true; clearTimeout(maxTimer); conn.end(); reject(err); return; }
          stream.on('data', (d: Buffer) => {
            stdout += d.toString();
            if (stdout.includes('"type":"result"')) {
              if (!settled) { settled = true; clearTimeout(maxTimer); conn.end(); resolve({ stdout, stderr }); }
            }
          });
          stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
          stream.on('close', () => {
            if (!settled) { settled = true; clearTimeout(maxTimer); conn.end(); resolve({ stdout, stderr }); }
          });
        });
      })
      .on('error', (err) => {
        if (!settled) { settled = true; clearTimeout(maxTimer); reject(err); }
      })
      .connect({ ...config, readyTimeout: 5_000 });
  });
}

export async function checkClaudeStatus(): Promise<ClaudeStatusResponse> {
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return { status: cachedResult.status, message: cachedResult.message };
  }

  try {
    const { stdout, stderr } = await runQuickClaudeCheck();
    const output = stdout + stderr;

    if (output.includes('Not logged in')) {
      cachedResult = { status: 'not_authenticated', timestamp: Date.now() };
      return { status: 'not_authenticated' };
    }

    cachedResult = { status: 'authenticated', timestamp: Date.now() };
    return { status: 'authenticated' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    cachedResult = { status: 'unreachable', message: msg, timestamp: Date.now() };
    return { status: 'unreachable', message: msg };
  }
}

export const claudeStatusRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/claude-status', async (request) => {
    request.authorized = true;
    return checkClaudeStatus();
  });
};
