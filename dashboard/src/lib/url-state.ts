/**
 * Helpers for reflecting list-page state in URL query params.
 *
 * Convention: the URL is the source of truth on mount (pages read it in lazy
 * useState initializers), afterwards a single sync effect mirrors state back
 * with `replace: true` so back/forward history isn't flooded. Default values
 * are removed from the URL entirely to keep shared links clean.
 */

/** Parse a comma-separated list param ("a,b,c") → ['a','b','c']; null/empty → []. */
export function parseListParam(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

/** Parse a comma-separated numeric list param; non-numeric entries are dropped. */
export function parseNumberListParam(value: string | null): number[] {
  return parseListParam(value)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/**
 * Parse a human-friendly 1-based `page` param into a 0-based page index.
 * Absent, invalid or out-of-range (< 2) values map to the first page (0).
 */
export function parsePageParam(value: string | null): number {
  if (value === null) return 0;
  const n = Number(value);
  return Number.isInteger(n) && n > 1 ? n - 1 : 0;
}

/** Return the param value when it's one of `allowed`, otherwise null. */
export function parseEnumParam<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | null {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * Set `key` to `value` when the value is non-empty; delete the param
 * otherwise. Keeps default state out of the URL.
 */
export function setOrDeleteParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
): void {
  if (value) params.set(key, value);
  else params.delete(key);
}
