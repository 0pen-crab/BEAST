/**
 * Thrown when a scan must be paused mid-flight (typically due to Claude rate limits).
 * The worker catches this, sets scan.status='paused' and scan.resumes_at, and the scan
 * will be picked up again automatically once `resumes_at` passes.
 */
export class ScanPausedError extends Error {
  constructor(message: string, public resumesAt?: string, public reason: string = 'rate_limit') {
    super(message);
    this.name = 'ScanPausedError';
  }
}

/** @deprecated Use ScanPausedError. Kept as alias for any external imports. */
export const RateLimitError = ScanPausedError;

/**
 * Backoff we wait after Claude Code exhausts its own retries on a transient
 * `529 Overloaded`. Deliberately generous (2 min) so we don't hammer Anthropic
 * and risk a real block — overload usually clears within seconds-to-minutes.
 */
export const OVERLOAD_BACKOFF_MS = 120_000;

export type RateLimitReason = 'rate_limit' | 'overloaded';

export interface RateLimitDetection {
  limited: boolean;
  /**
   * - `rate_limit`: our quota is exhausted (5-hour window). Wait until `resumesAt`.
   * - `overloaded`: Anthropic 529 that Claude Code couldn't retry away. Short backoff.
   */
  reason?: RateLimitReason;
  /** Only set for `rate_limit` (from the event's `resetsAt`). */
  resumesAt?: string;
}

/**
 * Decide whether Claude Code stream-json output indicates a real pause condition,
 * and which KIND — a quota rate limit vs. a transient 529 overload.
 *
 * CRITICAL: this must NOT naively substring-match the whole stdout. The
 * analyzer/scanner/triage agents read source code and emit reports that can
 * themselves contain strings like `"error":"rate_limit"` or "rate limit"
 * (e.g. scanning an app that implements API rate limiting). Those are CONTENT,
 * not control signals — matching them made scans pause on a phantom limit.
 *
 * We also IGNORE `api_retry` events (`type:"system", subtype:"api_retry"`):
 * those are Claude Code retrying a transient error on its own (with its own
 * `retry_delay_ms` backoff). We only act on the FINAL outcome:
 *  - LAST `rate_limit_event` with a hard-block `rate_limit_info.status`
 *    ("rejected") → quota limit. Advisory states ("allowed_warning" /
 *    approaching-the-limit) do NOT pause — they fire long before the block and
 *    used to park healthy scans for hours. Using the LAST event (Claude Code
 *    emits one per API call) means a mid-stream rejection wave that recovered
 *    and completed isn't discarded.
 *  - a `result` flagged `is_error: true` mentioning 529/overload/rate limit →
 *    Claude Code exhausted its retries → overload backoff.
 *  - a non-empty `errorMsg` from a failed invocation mentioning the same.
 */
const HARD_BLOCK_STATUSES = new Set(['rejected']);

export function detectRateLimit(stdout: string, errorMsg: string): RateLimitDetection {
  let lastRateLimitInfo: { status?: string; resetsAt?: number } | undefined;
  let overloaded = false;

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // partial / non-JSON line — ignore
    }

    // Track the LAST quota event — it reflects the final state of the call.
    if (ev.type === 'rate_limit_event') {
      lastRateLimitInfo = (ev.rate_limit_info ?? {}) as { status?: string; resetsAt?: number };
      continue;
    }

    // Final failure after Claude Code exhausted its own retries (e.g. 529).
    if (ev.type === 'result' && ev.is_error === true) {
      const blob = `${ev.result ?? ''} ${ev.api_error_status ?? ''}`.toLowerCase();
      if (blob.includes('529') || blob.includes('overload')
          || blob.includes('rate limit') || blob.includes('rate_limit')
          || blob.includes('out of extra usage')) {
        overloaded = true;
      }
    }
  }

  // Quota rate limit — authoritative, carries the real reset time. Only pause
  // on an explicit hard block; warning/approaching statuses are advisories.
  if (typeof lastRateLimitInfo?.status === 'string'
      && HARD_BLOCK_STATUSES.has(lastRateLimitInfo.status)) {
    const resumesAt = typeof lastRateLimitInfo.resetsAt === 'number'
      ? new Date(lastRateLimitInfo.resetsAt * 1000).toISOString()
      : undefined;
    return { limited: true, reason: 'rate_limit', resumesAt };
  }

  if (overloaded) {
    return { limited: true, reason: 'overloaded' };
  }

  const em = (errorMsg || '').toLowerCase();
  if (em && (em.includes('529') || em.includes('overload')
      || em.includes('out of extra usage')
      || em.includes('rate limit') || em.includes('rate_limit'))) {
    return { limited: true, reason: 'overloaded' };
  }

  return { limited: false };
}

/**
 * Check if Claude output indicates a pause condition. If so: notify the API to
 * pause the worker queue, then throw ScanPausedError so callers can checkpoint
 * and propagate the pause. A quota `rate_limit` waits until its `resetsAt`; a
 * transient `overloaded` (529) waits a short fixed backoff.
 */
export function checkRateLimitAndPause(stdout: string, errorMsg: string): void {
  const det = detectRateLimit(stdout, errorMsg);
  if (!det.limited) return;

  const resumesAt = det.resumesAt
    ?? new Date(Date.now() + OVERLOAD_BACKOFF_MS).toISOString();
  const isOverload = det.reason === 'overloaded';

  console.log(`[rate-limit] ${isOverload ? 'Anthropic overloaded (529)' : 'Claude rate limit'} detected, pausing worker queue (resumes at ${resumesAt})`);

  const apiUrl = process.env.API_SELF_URL || 'http://api:3000';
  const token = process.env.INTERNAL_TOKEN || '';
  fetch(`${apiUrl}/api/worker/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
    body: JSON.stringify({ reason: det.reason, resumesAt }),
  }).catch(err => console.error('[rate-limit] Failed to notify API:', err.message));

  const msg = isOverload
    ? `Anthropic API overloaded (529) — backing off until ${new Date(resumesAt).toLocaleTimeString()}`
    : `Claude AI rate limit reached (resets at ${new Date(resumesAt).toLocaleTimeString()})`;
  throw new ScanPausedError(msg, resumesAt, det.reason ?? 'rate_limit');
}
