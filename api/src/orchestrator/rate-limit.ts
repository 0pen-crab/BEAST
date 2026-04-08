export class RateLimitError extends Error {
  constructor(message: string, public resumesAt?: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Check if Claude output indicates a rate limit.
 * If so: notify API to pause the queue, then throw RateLimitError to fail the scan.
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

  throw new RateLimitError(`Claude AI rate limit reached${resumesAt ? ` (resets at ${new Date(resumesAt).toLocaleTimeString()})` : ''}`, resumesAt);
}
