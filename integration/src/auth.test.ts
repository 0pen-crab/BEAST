import { describe, it, expect, beforeAll } from 'vitest';
import { api, registerTestUser, type AuthContext } from './helpers.ts';

describe('auth', () => {
  let auth: AuthContext;
  const username = `auth_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const password = 'testpass123';

  it('registers a new user', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe(username);
    expect(body.user.id).toBeGreaterThan(0);
    auth = body;
  });

  it('logs in with the registered user', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe(username);
  });

  it('rejects login with wrong password', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'wrongpass' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects login with nonexistent user', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'nonexistent_user_xyz', password }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects login with empty username', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: '', password }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects register with short password', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: `short_pw_${Date.now()}`, password: '123' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate registration', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(409);
  });

  it('GET /auth/me returns user info with valid token', async () => {
    const res = await api('/auth/me', {
      headers: { Authorization: `Token ${auth.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBe(username);
  });

  it('GET /auth/me rejects without token', async () => {
    const res = await api('/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /auth/me rejects with invalid token', async () => {
    const res = await api('/auth/me', {
      headers: { Authorization: 'Token invalid_token_xyz' },
    });
    expect(res.status).toBe(401);
  });

  it('logout invalidates the token', async () => {
    // Login to get a fresh token for logout test
    const loginRes = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const { token } = await loginRes.json();

    // Logout
    const logoutRes = await api('/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    });
    expect(logoutRes.status).toBe(204);

    // Token should no longer work
    const meRes = await api('/auth/me', {
      headers: { Authorization: `Token ${token}` },
    });
    expect(meRes.status).toBe(401);
  });
});
