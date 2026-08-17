/**
 * Global API client — ALL requests to /api/* go through here.
 * Auth headers are injected automatically. Never use raw fetch() for API calls.
 */

const TOKEN_KEY = 'beast_token';

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Drop-in replacement for fetch() that automatically adds auth headers
 * for any request to /api/* paths.
 */
export async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  // Only inject auth for API calls (handles both relative "/api/..." and full "http://.../api/...")
  const isApiCall = url.startsWith('/api') || url.includes('/api/');
  if (!isApiCall) {
    return fetch(input, init);
  }

  const token = getToken();
  const headers = new Headers(init?.headers);

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Token ${token}`);
  }

  return fetch(input, { ...init, headers });
}

/**
 * Extract a human-readable error message from a non-2xx response body.
 * API errors are JSON ({ message } or { error }); anything else (nginx 502
 * pages, plain text) falls back to the raw body text.
 */
export async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch((err) => {
    console.error('[api] Failed to read error response body:', err);
    return `HTTP ${res.status}`;
  });
  try {
    const parsed = JSON.parse(text);
    return parsed.message ?? parsed.error ?? text;
  } catch {
    return text; // response is not JSON — the raw body IS the message
  }
}

/**
 * Typed GET helper — fetches JSON with auth.
 */
export async function fetchApi<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return res.json();
}

/**
 * Raw GET helper — like fetchApi but returns the Response untouched,
 * for non-JSON payloads (plain text logs, CSV/blob downloads).
 * Throws the same parsed error message as fetchApi on non-2xx.
 */
export async function fetchApiRaw(url: string, init?: RequestInit): Promise<Response> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return res;
}

/**
 * Typed mutation helper — POST/PUT/PATCH/DELETE with auth + JSON body.
 */
export async function mutateApi<T>(url: string, options: RequestInit): Promise<T> {
  const hasBody = options.body !== undefined && options.body !== null;
  const headers = new Headers(options.headers);
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await apiFetch(url, { ...options, headers });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
