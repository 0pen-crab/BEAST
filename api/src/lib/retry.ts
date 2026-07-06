export interface RetryOptions {
  /** Total attempts including the first call. Default 3. */
  attempts?: number;
  /** Base delay before the first retry; doubles each retry. Default 500ms. */
  backoffMs?: number;
  /** Return false to rethrow immediately instead of retrying. Default: retry everything. */
  shouldRetry?: (err: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying failures with exponential backoff (backoffMs, 2x, 4x, ...).
 * Rethrows the last error when attempts are exhausted or shouldRetry(err) is false.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, backoffMs = 500, shouldRetry = () => true } = options;
  if (attempts < 1) throw new Error(`withRetry: attempts must be >= 1, got ${attempts}`);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !shouldRetry(err)) throw err;
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
  throw lastError; // unreachable, satisfies the compiler
}
