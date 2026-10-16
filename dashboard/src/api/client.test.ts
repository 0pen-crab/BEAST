import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchApi, fetchApiRaw, mutateApi } from './client';

function jsonRes(body: unknown, status = 500) {
  const text = JSON.stringify(body);
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text),
  };
}

describe('client error parsing', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetchApi: prefers `message` over `error` when both present', async () => {
    mockFetch.mockResolvedValueOnce(jsonRes({
      statusCode: 500,
      error: 'Error',
      message: 'GitLab: could not find user or group "x"',
    }));
    await expect(fetchApi('/api/x')).rejects.toThrow(
      'GitLab: could not find user or group "x"',
    );
  });

  it('fetchApi: uses `error` when `message` is absent', async () => {
    mockFetch.mockResolvedValueOnce(jsonRes({ error: 'Source already connected' }, 409));
    await expect(fetchApi('/api/x')).rejects.toThrow('Source already connected');
  });

  it('fetchApi: falls back to raw text when body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('Bad Gateway'),
    });
    await expect(fetchApi('/api/x')).rejects.toThrow('Bad Gateway');
  });

  it('mutateApi: prefers `message` over `error` when both present', async () => {
    mockFetch.mockResolvedValueOnce(jsonRes({
      statusCode: 500,
      error: 'Error',
      message: 'Real failure reason',
    }));
    await expect(
      mutateApi('/api/x', { method: 'POST', body: '{}' }),
    ).rejects.toThrow('Real failure reason');
  });

  it('mutateApi: uses `error` when `message` is absent', async () => {
    mockFetch.mockResolvedValueOnce(jsonRes({ error: 'Validation failed' }, 400));
    await expect(
      mutateApi('/api/x', { method: 'POST', body: '{}' }),
    ).rejects.toThrow('Validation failed');
  });
});

describe('fetchApiRaw', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.removeItem('beast_token');
  });

  it('returns the raw Response for non-JSON payloads (text/blob)', async () => {
    const res = {
      ok: true,
      status: 200,
      text: () => Promise.resolve('csv,data'),
      blob: () => Promise.resolve(new Blob(['csv,data'])),
    };
    mockFetch.mockResolvedValueOnce(res);

    const out = await fetchApiRaw('/api/findings/export.csv');
    expect(out).toBe(res as unknown as Response);
    await expect(out.text()).resolves.toBe('csv,data');
  });

  it('injects the auth Token header for /api/ URLs', async () => {
    localStorage.setItem('beast_token', 'tok-raw');
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await fetchApiRaw('/api/scan-logs/scan-1/triage');

    const [, init] = mockFetch.mock.calls[0];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Token tok-raw');
  });

  it('throws the parsed error message on non-2xx like fetchApi', async () => {
    mockFetch.mockResolvedValueOnce(jsonRes({ error: 'Log not found' }, 404));
    await expect(fetchApiRaw('/api/x')).rejects.toThrow('Log not found');
  });

  it('falls back to raw text when the error body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('Bad Gateway'),
    });
    await expect(fetchApiRaw('/api/x')).rejects.toThrow('Bad Gateway');
  });
});
