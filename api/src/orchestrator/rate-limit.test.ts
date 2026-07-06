import { describe, it, expect } from 'vitest';
import { detectRateLimit } from './rate-limit.ts';

// A realistic rate_limit_event line as emitted by Claude Code on EVERY call.
const allowedEvent = JSON.stringify({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed', resetsAt: 1783020600, rateLimitType: 'five_hour', overageStatus: 'rejected' },
});
const successResult = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' });

describe('detectRateLimit', () => {
  it('does NOT flag a limit when the rate_limit_event status is "allowed"', () => {
    const stdout = [allowedEvent, successResult].join('\n');
    expect(detectRateLimit(stdout, '')).toEqual({ limited: false });
  });

  it('does NOT flag a limit when scanned CONTENT contains rate-limit strings (the bug)', () => {
    // Simulates the analyzer/triage output for a repo that implements API rate
    // limiting: the report text and quoted code contain "rate limit" and even a
    // literal {"error":"rate_limit"} — these are content, not control signals.
    const assistant = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'text',
          text: 'Without rate limiting the endpoint is exposed. Example response: {"error":"rate_limit"}',
        }],
      },
    });
    const stdout = [allowedEvent, assistant, successResult].join('\n');
    expect(detectRateLimit(stdout, '')).toEqual({ limited: false });
  });

  it('does NOT flag a limit for a transient api_retry that ultimately succeeded (the real bug)', () => {
    // Exact shape that caused the phantom pause: Claude Code hit a 529, retried
    // it itself (api_retry), and the call SUCCEEDED. We must not pause on this.
    const apiRetry = JSON.stringify({
      type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10,
      retry_delay_ms: 595.54, error_status: 529, error: 'rate_limit',
    });
    const stdout = [allowedEvent, apiRetry, successResult].join('\n');
    expect(detectRateLimit(stdout, '')).toEqual({ limited: false });
  });

  it('flags a QUOTA rate_limit when event status is "rejected", with resetsAt', () => {
    const rejected = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: 1783020600 },
    });
    const res = detectRateLimit(rejected, '');
    expect(res.limited).toBe(true);
    expect(res.reason).toBe('rate_limit');
    expect(res.resumesAt).toBe(new Date(1783020600 * 1000).toISOString());
  });

  it('does NOT flag advisory statuses like "allowed_warning" (approaching the limit)', () => {
    // Claude Code emits warning/approaching states well before the hard block.
    // Pausing on those parked healthy scans for hours.
    const warning = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed_warning', resetsAt: 1783020600 },
    });
    const stdout = [warning, successResult].join('\n');
    expect(detectRateLimit(stdout, '')).toEqual({ limited: false });
  });

  it('uses the LAST rate_limit_event: a rejected wave that recovered is not a limit', () => {
    // Mid-stream rejection followed by a later "allowed" event and a successful
    // result means the limit cleared while the call was running — do not pause.
    const rejected = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: 1783020600 },
    });
    const stdout = [rejected, allowedEvent, successResult].join('\n');
    expect(detectRateLimit(stdout, '')).toEqual({ limited: false });
  });

  it('uses the LAST rate_limit_event: allowed followed by rejected IS a limit', () => {
    const rejected = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: 1783020600 },
    });
    const stdout = [allowedEvent, rejected].join('\n');
    const res = detectRateLimit(stdout, '');
    expect(res.limited).toBe(true);
    expect(res.reason).toBe('rate_limit');
    expect(res.resumesAt).toBe(new Date(1783020600 * 1000).toISOString());
  });

  it('flags an OVERLOAD when Claude Code exhausts retries on a 529 (is_error result)', () => {
    const errResult = JSON.stringify({
      type: 'result', subtype: 'error', is_error: true,
      result: 'API Error: 529 Overloaded after 10 retries',
    });
    const res = detectRateLimit(errResult, '');
    expect(res.limited).toBe(true);
    expect(res.reason).toBe('overloaded');
    expect(res.resumesAt).toBeUndefined(); // caller applies the fixed backoff
  });

  it('does NOT flag an is_error result whose message is unrelated', () => {
    const errResult = JSON.stringify({
      type: 'result', is_error: true, result: 'Not logged in',
    });
    expect(detectRateLimit(errResult, '').limited).toBe(false);
  });

  it('flags overload from an explicit error message ("out of extra usage")', () => {
    const res = detectRateLimit('', 'You are out of extra usage for this period');
    expect(res.limited).toBe(true);
    expect(res.reason).toBe('overloaded');
  });

  it('tolerates non-JSON / partial lines without throwing', () => {
    const stdout = ['not json', '{partial', allowedEvent, successResult].join('\n');
    expect(detectRateLimit(stdout, '')).toEqual({ limited: false });
  });
});
