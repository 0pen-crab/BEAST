import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scanFiles } from '../db/schema.ts';
import { addScanFile } from './entities.ts';
import {
  sshExec,
  sshWriteFile,
  getClaudeRunnerConfig,
  parseStreamJsonResult,
  SSHTimeoutError,
} from './ssh.ts';
import { checkRateLimitAndPause } from './rate-limit.ts';

export const AI_TRACE_FILE_TYPE = 'ai-trace';

export interface TraceInput {
  scanId: string;
  wave: string;
  prompt: string;
  stdout: string;
  errorMessage?: string | null;
}

/**
 * Persist the raw stream-json stdout from a Claude call plus the prompt that
 * triggered it. Designed to be called from a try/finally — passing partial
 * stdout on failure is fine, the UI surfaces whatever lines made it through.
 *
 * File body layout (one JSON object per line, in order):
 *   {"type":"prompt","content":"…"}
 *   …raw stream-json lines from Claude…
 *   {"type":"trace_error","message":"…"}   (only when errorMessage set)
 */
export async function persistTrace(input: TraceInput): Promise<void> {
  const lines: string[] = [];
  lines.push(JSON.stringify({ type: 'prompt', content: input.prompt }));
  const stdoutLines = input.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  for (const l of stdoutLines) lines.push(l);
  if (input.errorMessage) {
    lines.push(JSON.stringify({ type: 'trace_error', message: input.errorMessage }));
  }

  try {
    await addScanFile({
      scanId: input.scanId,
      fileName: `${input.wave}.jsonl`,
      fileType: AI_TRACE_FILE_TYPE,
      content: lines.join('\n'),
    });
  } catch (err) {
    // Trace persistence is best-effort — a DB hiccup here must not mask the
    // original wave outcome. Surface loudly in worker logs.
    console.error(`[trace-store] Failed to persist ${input.wave} trace for scan ${input.scanId}:`,
      err instanceof Error ? err.message : err);
  }
}

/**
 * Run a Claude wave invocation while capturing its full stream-json output to
 * scan_files. Use this instead of calling sshExec + parseStreamJsonResult
 * directly so traces are persisted even when the wave throws.
 *
 * Does NOT throw on `is_error` results — callers inspect `parsed.is_error`
 * themselves (waves 1/2/3 throw, wave4 returns 'refuted', report-builder
 * falls back to a minimal markdown).
 */
export async function runClaudeWithTrace(opts: {
  scanId: string;
  wave: string;
  prompt: string;
  /** Args to pass after `claude` (e.g. `-p --model … --verbose --output-format stream-json …`). */
  claudeArgs: string;
  inactivityTimeoutMs: number;
  maxTimeoutMs: number;
  cancelSignal?: AbortSignal;
}): Promise<{ stdout: string; parsed: Record<string, unknown> }> {
  const config = getClaudeRunnerConfig();

  // Write prompt to a temp file via SFTP and pipe into Claude via `cat`.
  // Embedding the prompt in the shell command via `echo "..."` is unsafe:
  // markdown code-fences (backticks) inside the prompt are interpreted as
  // bash command-substitution and quietly corrupt or abort the pipeline —
  // observed with Wave 2 prompts producing zero stdout.
  //
  // `trap "kill 0" TERM`: ssh2's signal('TERM') sends SIGTERM only to the bash
  // wrapper, not to its child `claude` binary. Without the trap, cancelled
  // scans leave orphan `claude` processes running on claude-runner. The trap
  // forwards TERM to every process in the bash session group.
  // NOTE: no trailing `; rm -f ${promptPath}` here. ssh.ts early-resolves and
  // closes the session as soon as the result JSON appears, SIGHUPing the shell —
  // an inline rm would never run on success and the tmp files would accumulate
  // forever. Cleanup happens via a separate best-effort call in the finally.
  const promptPath = `/tmp/claude-prompt-${opts.scanId}-${opts.wave}-${randomUUID()}.txt`;
  await sshWriteFile(config, promptPath, opts.prompt, opts.cancelSignal);
  const command = `trap "kill 0" TERM; cat ${promptPath} | claude ${opts.claudeArgs}`;

  let stdout = '';
  let errorMessage: string | null = null;
  try {
    try {
      const result = await sshExec(config, command, {
        inactivityTimeoutMs: opts.inactivityTimeoutMs,
        maxTimeoutMs: opts.maxTimeoutMs,
        signal: opts.cancelSignal,
      });
      stdout = result.stdout;
      checkRateLimitAndPause(stdout, '');
    } catch (err) {
      // Record the failure BEFORE the rate-limit re-check below: it can rethrow
      // ScanPausedError, and the trace persisted in the finally must still carry
      // the original error message (and partial stdout).
      errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof SSHTimeoutError && err.stdout) {
        stdout = err.stdout;
        checkRateLimitAndPause(stdout, '');
      }
      throw err;
    }
    const { result: parsed } = parseStreamJsonResult(stdout);
    if ((parsed as Record<string, unknown>).is_error) {
      errorMessage = String((parsed as Record<string, unknown>).result ?? 'agent reported error');
    }
    return { stdout, parsed: parsed as Record<string, unknown> };
  } finally {
    // Best-effort cleanup of the prompt tmp file — success or failure alike.
    // Wrap in Promise.resolve so a mocked sshExec returning non-promise
    // doesn't throw before the await.
    try {
      await Promise.resolve(sshExec(config, `rm -f ${promptPath}`));
    } catch (cleanupErr) {
      console.warn(`[trace-store] Failed to remove prompt tmp file ${promptPath}:`,
        cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
    await persistTrace({
      scanId: opts.scanId,
      wave: opts.wave,
      prompt: opts.prompt,
      stdout,
      errorMessage,
    });
  }
}

/**
 * Remove existing trace files for a scan before a fresh run. The orchestrator
 * reruns individual scan steps on retry — older traces from the same scan id
 * would be misleading, so the pipeline calls this at start for FRESH runs only
 * (resumed scans keep the traces of already-completed waves).
 */
export async function clearTraces(scanId: string): Promise<void> {
  await db.delete(scanFiles).where(
    and(
      eq(scanFiles.scanId, scanId),
      eq(scanFiles.fileType, AI_TRACE_FILE_TYPE),
    ),
  );
}
