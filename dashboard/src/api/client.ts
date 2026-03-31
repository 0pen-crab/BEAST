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
 * Typed GET helper — fetches JSON with auth.
 */
export async function fetchApi<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) {
    const text = await res.text().catch((err) => {
      console.error('[api] Failed to read error response body:', err);
      return `HTTP ${res.status}`;
    });
    let message = text;
    try { const parsed = JSON.parse(text); message = parsed.error ?? parsed.message ?? text; } catch { /* response is not JSON */ }
    throw new Error(message);
  }
  return res.json();
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
    const text = await res.text().catch((err) => {
      console.error('[api] Failed to read error response body:', err);
      return `HTTP ${res.status}`;
    });
    let message = text;
    try { const parsed = JSON.parse(text); message = parsed.error ?? parsed.message ?? text; } catch { /* response is not JSON */ }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
