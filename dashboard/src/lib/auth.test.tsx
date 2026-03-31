import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth';
import type { ReactNode } from 'react';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

const fakeUser = {
  id: 1,
  username: 'admin',
  displayName: 'Admin User',
  role: 'admin',
};

const fakeToken = 'tok_abc123';

// Helper: mock /api/auth/me that returns user JSON
function mockMeSuccess(user = fakeUser) {
  return { ok: true, json: async () => user };
}

// ---------- 1. Initial state ----------

describe('initial state', () => {
  it('is unauthenticated when localStorage is empty', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('is authenticated when token and user exist in localStorage', () => {
    localStorage.setItem('beast_token', fakeToken);
    localStorage.setItem('beast_user', JSON.stringify(fakeUser));
    mockFetch.mockResolvedValueOnce(mockMeSuccess());

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe(fakeToken);
  });

  it('has token but no user when beast_user is missing', () => {
    localStorage.setItem('beast_token', fakeToken);
    mockFetch.mockResolvedValueOnce(mockMeSuccess());

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe(fakeToken);
    expect(result.current.user).toBeNull();
  });

  it('handles corrupted JSON in beast_user gracefully', () => {
    localStorage.setItem('beast_token', fakeToken);
    localStorage.setItem('beast_user', '{not valid json');
    mockFetch.mockResolvedValueOnce(mockMeSuccess());

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe(fakeToken);
    expect(result.current.user).toBeNull();
  });

  it('clears stale token when /api/auth/me returns non-ok', async () => {
    localStorage.setItem('beast_token', 'stale_token');
    localStorage.setItem('beast_user', JSON.stringify(fakeUser));
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('beast_token')).toBeNull();
    expect(localStorage.getItem('beast_user')).toBeNull();
  });
});

// ---------- 2. login ----------

describe('login', () => {
  it('stores token and user on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: fakeToken, user: fakeUser }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login('admin', 'password');
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe(fakeToken);
    expect(result.current.user).toEqual(fakeUser);
    expect(localStorage.getItem('beast_token')).toBe(fakeToken);
    expect(localStorage.getItem('beast_user')).toBe(JSON.stringify(fakeUser));
  });

  it('sends correct API call shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: fakeToken, user: fakeUser }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login('testuser', 'secret');
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ username: 'testuser', password: 'secret' }),
    }));
  });

  it('throws on failure with error from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid credentials' }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.login('bad', 'creds');
      }),
    ).rejects.toThrow('Invalid credentials');

    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem('beast_token')).toBeNull();
  });

  it('uses fallback error message when response JSON parse fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => { throw new Error('parse error'); },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.login('bad', 'creds');
      }),
    ).rejects.toThrow('Login failed');
  });

  it('uses fallback when error field is empty string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: '' }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.login('bad', 'creds');
      }),
    ).rejects.toThrow('Login failed');
  });

  it('stores mustChangePassword from login response', async () => {
    const userWithFlag = { ...fakeUser, mustChangePassword: true };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: fakeToken, user: userWithFlag }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login('admin', 'temppass');
    });

    expect(result.current.mustChangePassword).toBe(true);
  });
});

// ---------- 3. logout ----------

describe('logout', () => {
  it('clears state and localStorage', async () => {
    localStorage.setItem('beast_token', fakeToken);
    localStorage.setItem('beast_user', JSON.stringify(fakeUser));

    // Mock /api/auth/me validation + logout API call
    mockFetch.mockResolvedValueOnce(mockMeSuccess());
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(true);

    act(() => {
      result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('beast_token')).toBeNull();
    expect(localStorage.getItem('beast_user')).toBeNull();
  });

  it('sends API call with token in Authorization header', () => {
    localStorage.setItem('beast_token', fakeToken);
    localStorage.setItem('beast_user', JSON.stringify(fakeUser));

    // Mock /api/auth/me validation + logout API call
    mockFetch.mockResolvedValueOnce(mockMeSuccess());
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      result.current.logout();
    });

    // apiFetch adds Authorization header via Headers object
    const logoutCall = mockFetch.mock.calls.find((c: any[]) => c[0] === '/api/auth/logout');
    expect(logoutCall).toBeDefined();
    expect(logoutCall![1].method).toBe('POST');
    const headers = logoutCall![1].headers as Headers;
    expect(headers.get('Authorization')).toBe(`Token ${fakeToken}`);
  });

  it('does not call API when no token exists', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      result.current.logout();
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('handles API failure silently', () => {
    localStorage.setItem('beast_token', fakeToken);
    localStorage.setItem('beast_user', JSON.stringify(fakeUser));

    // Mock /api/auth/me validation + logout API call (fails)
    mockFetch.mockResolvedValueOnce(mockMeSuccess());
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Should not throw
    act(() => {
      result.current.logout();
    });

    // State should still be cleared regardless of API failure
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(localStorage.getItem('beast_token')).toBeNull();
    expect(localStorage.getItem('beast_user')).toBeNull();
  });
});

// ---------- 4. mustChangePassword ----------

describe('mustChangePassword', () => {
  it('defaults to false', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.mustChangePassword).toBe(false);
  });

  it('is set from localStorage user data', () => {
    const userWithFlag = { ...fakeUser, mustChangePassword: true };
    localStorage.setItem('beast_token', fakeToken);
    localStorage.setItem('beast_user', JSON.stringify(userWithFlag));
    mockFetch.mockResolvedValueOnce(mockMeSuccess(userWithFlag));

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.mustChangePassword).toBe(true);
  });

  it('clearMustChangePassword updates state and localStorage', async () => {
    const userWithFlag = { ...fakeUser, mustChangePassword: true };
    localStorage.setItem('beast_token', fakeToken);
    localStorage.setItem('beast_user', JSON.stringify(userWithFlag));
    mockFetch.mockResolvedValueOnce(mockMeSuccess(userWithFlag));

    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      result.current.clearMustChangePassword();
    });

    expect(result.current.mustChangePassword).toBe(false);
    const storedUser = JSON.parse(localStorage.getItem('beast_user')!);
    expect(storedUser.mustChangePassword).toBe(false);
  });
});

// ---------- 5. useAuth outside provider ----------

describe('useAuth outside provider', () => {
  it('throws error when used outside AuthProvider', () => {
    // Suppress React error boundary console.error noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within AuthProvider');

    spy.mockRestore();
  });
});
