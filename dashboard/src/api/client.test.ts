import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchApi, mutateApi } from './client';

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
