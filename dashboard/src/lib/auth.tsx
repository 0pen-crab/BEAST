import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { apiFetch } from '@/api/client';

interface AuthUser {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
  mustChangePassword?: boolean;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  mustChangePassword: boolean;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'beast_token';
const USER_KEY = 'beast_user';

function loadState(): AuthState {
  const token = localStorage.getItem(TOKEN_KEY);
  const userJson = localStorage.getItem(USER_KEY);
  let user: AuthUser | null = null;
  if (userJson) {
    try { user = JSON.parse(userJson); } catch (err) {
      console.error('[auth] Failed to parse stored user data, clearing:', err);
      localStorage.removeItem(USER_KEY);
    }
  }
  return { token, user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadState);

  // Validate token on startup — refresh user data from server
  useEffect(() => {
    if (!state.token) return;
    apiFetch('/api/auth/me').then(async (res) => {
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setState({ token: null, user: null });
      } else {
        const userData = await res.json();
        localStorage.setItem(USER_KEY, JSON.stringify(userData));
        setState((prev) => ({ ...prev, user: userData }));
      }
    }).catch((err) => {
      console.error('[auth] Token validation failed:', err);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json() as { token: string; user: AuthUser };
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setState({ token: data.token, user: data.user });
  }, []);

  const logout = useCallback(() => {
    if (localStorage.getItem(TOKEN_KEY)) {
      apiFetch('/api/auth/logout', {
        method: 'POST',
      }).catch((err) => {
        console.error('[auth] Logout request failed:', err);
      });
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ token: null, user: null });
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setState((prev) => {
      const updatedUser = prev.user ? { ...prev.user, mustChangePassword: false } : null;
      if (updatedUser) {
        localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
      }
      return { ...prev, user: updatedUser };
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        isAuthenticated: !!state.token,
        mustChangePassword: state.user?.mustChangePassword ?? false,
        clearMustChangePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
