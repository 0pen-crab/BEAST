import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateGitGuardian,
  validateSnyk,
  validateJFrog,
  getValidator,
} from './tool-validators.ts';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

// Helper to create a minimal Response-like object
function makeResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

describe('validateGitGuardian', () => {
  it('returns valid:true when health endpoint returns 200', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200));

    const result = await validateGitGuardian({ GITGUARDIAN_API_KEY: 'mykey' });

    expect(result).toEqual({ valid: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.gitguardian.com/v1/health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Token mykey' }),
      }),
    );
  });

  it('returns invalid with error message on 401', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(401));

    const result = await validateGitGuardian({ GITGUARDIAN_API_KEY: 'badkey' });

    expect(result).toEqual({ valid: false, error: 'Invalid API key' });
  });

  it('returns invalid with error message on 429', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(429));

    const result = await validateGitGuardian({ GITGUARDIAN_API_KEY: 'somekey' });

    expect(result).toEqual({ valid: false, error: 'Rate limited — try again in a moment' });
  });

  it('returns invalid with network error message on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const result = await validateGitGuardian({ GITGUARDIAN_API_KEY: 'somekey' });

    expect(result).toEqual({ valid: false, error: 'Could not reach GitGuardian API' });
  });

  it('returns invalid with timeout error on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await validateGitGuardian({ GITGUARDIAN_API_KEY: 'somekey' });

    expect(result).toEqual({ valid: false, error: 'Connection timed out' });
  });

  it('returns invalid with missing credentials error when key is absent', async () => {
    const result = await validateGitGuardian({});

    expect(result).toEqual({ valid: false, error: 'Missing API key' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('validateSnyk', () => {
  it('returns valid:true when self endpoint returns 200', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200));

    const result = await validateSnyk({ SNYK_TOKEN: 'mytoken' });

    expect(result).toEqual({ valid: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.snyk.io/rest/self?version=2024-10-15',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'token mytoken' }),
      }),
    );
  });

  it('returns invalid with error message on 401', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(401));

    const result = await validateSnyk({ SNYK_TOKEN: 'badtoken' });

    expect(result).toEqual({ valid: false, error: 'Invalid Snyk token' });
  });

  it('returns invalid with network error message on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const result = await validateSnyk({ SNYK_TOKEN: 'sometoken' });

    expect(result).toEqual({ valid: false, error: 'Could not reach Snyk API' });
  });

  it('returns invalid with missing credentials error when token is absent', async () => {
    const result = await validateSnyk({});

    expect(result).toEqual({ valid: false, error: 'Missing API token' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('validateJFrog', () => {
  it('returns valid:true when both version check and token check succeed', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200)) // version check
      .mockResolvedValueOnce(makeResponse(200)); // token check

    const result = await validateJFrog({
      JF_URL: 'https://example.jfrog.io',
      JF_ACCESS_TOKEN: 'mytoken',
    });

    expect(result).toEqual({ valid: true });
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://example.jfrog.io/xray/api/v1/system/version',
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.jfrog.io/access/api/v1/cert/root',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mytoken' }),
      }),
    );
  });

  it('returns invalid with URL error when version check returns non-ok', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(404)); // version check fails

    const result = await validateJFrog({
      JF_URL: 'https://bad.jfrog.io',
      JF_ACCESS_TOKEN: 'mytoken',
    });

    expect(result).toEqual({
      valid: false,
      error: 'Could not reach JFrog instance at https://bad.jfrog.io',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns invalid with URL error when version check throws network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const result = await validateJFrog({
      JF_URL: 'https://bad.jfrog.io',
      JF_ACCESS_TOKEN: 'mytoken',
    });

    expect(result).toEqual({
      valid: false,
      error: 'Could not reach JFrog instance at https://bad.jfrog.io',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns invalid with token error when URL ok but token check returns 401', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200)) // version check ok
      .mockResolvedValueOnce(makeResponse(401)); // token check fails

    const result = await validateJFrog({
      JF_URL: 'https://example.jfrog.io',
      JF_ACCESS_TOKEN: 'badtoken',
    });

    expect(result).toEqual({ valid: false, error: 'Invalid access token' });
  });

  it('returns invalid with token error when URL ok but token check returns 403', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200)) // version check ok
      .mockResolvedValueOnce(makeResponse(403)); // token check fails

    const result = await validateJFrog({
      JF_URL: 'https://example.jfrog.io',
      JF_ACCESS_TOKEN: 'badtoken',
    });

    expect(result).toEqual({ valid: false, error: 'Invalid access token' });
  });

  it('returns invalid with missing credentials error when URL is absent', async () => {
    const result = await validateJFrog({ JF_ACCESS_TOKEN: 'token' });

    expect(result).toEqual({ valid: false, error: 'Missing JFrog URL' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns invalid with missing credentials error when token is absent', async () => {
    const result = await validateJFrog({ JF_URL: 'https://example.jfrog.io' });

    expect(result).toEqual({ valid: false, error: 'Missing access token' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('getValidator', () => {
  it('returns validateGitGuardian for gitguardian key', () => {
    const validator = getValidator('gitguardian');
    expect(validator).toBe(validateGitGuardian);
  });

  it('returns validateSnyk for snyk-code key', () => {
    const validator = getValidator('snyk-code');
    expect(validator).toBe(validateSnyk);
  });

  it('returns validateSnyk for snyk-sca key', () => {
    const validator = getValidator('snyk-sca');
    expect(validator).toBe(validateSnyk);
  });

  it('returns validateSnyk for snyk-iac key', () => {
    const validator = getValidator('snyk-iac');
    expect(validator).toBe(validateSnyk);
  });

  it('returns validateJFrog for jfrog key', () => {
    const validator = getValidator('jfrog');
    expect(validator).toBe(validateJFrog);
  });

  it('returns undefined for unknown key', () => {
    const validator = getValidator('gitleaks');
    expect(validator).toBeUndefined();
  });

  it('returns undefined for completely unknown key', () => {
    const validator = getValidator('nonexistent-tool');
    expect(validator).toBeUndefined();
  });
});
