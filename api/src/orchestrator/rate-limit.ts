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
 * Check if Claude output indicates a rate limit.
 * If so: notify API to pause the worker queue, then throw ScanPausedError so callers
 * can record per-module checkpoint state and propagate the pause up the stack.
 */
export function checkRateLimitAndPause(stdout: string, errorMsg: string): void {
  const isRateLimit = stdout.includes('"error":"rate_limit"')
    || errorMsg.includes('out of extra usage')
    || errorMsg.includes('rate limit');

  if (!isRateLimit) return;

  // Extract resetsAt from rate_limit_event if available
  let resumesAt: string | undefined;
  try {
    const match = stdout.match(/"resetsAt"\s*:\s*(\d+)/);
    if (match) {
      resumesAt = new Date(Number(match[1]) * 1000).toISOString();
    }
  } catch { /* ignore parse errors */ }

  console.log(`[rate-limit] Claude rate limit detected, pausing worker queue${resumesAt ? ` (resets at ${resumesAt})` : ''}`);

  const apiUrl = process.env.API_SELF_URL || 'http://api:3000';
  const token = process.env.INTERNAL_TOKEN || '';
  fetch(`${apiUrl}/api/worker/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
    body: JSON.stringify({ reason: 'rate_limit', resumesAt }),
  }).catch(err => console.error('[rate-limit] Failed to notify API:', err.message));

  throw new ScanPausedError(
    `Claude AI rate limit reached${resumesAt ? ` (resets at ${new Date(resumesAt).toLocaleTimeString()})` : ''}`,
    resumesAt,
    'rate_limit',
  );
}
