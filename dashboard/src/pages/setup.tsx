import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import { AuthLayout } from '@/components/auth-layout';

const inputClass =
  'w-full border-2 border-[#2a2a2a] bg-[#0f0f11] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-beast-red focus:outline-none transition-colors font-body';

const labelClass =
  'block text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-400 mb-2';

export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    apiFetch('/api/auth/setup-status')
      .then((res) => res.json())
      .then((data: { needsSetup: boolean }) => {
        if (!data.needsSetup) navigate('/login', { replace: true });
        else setChecking(false);
      })
      .catch((err) => {
        console.error('[setup] setup-status check failed:', err);
        setChecking(false);
      });
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('setup.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Setup failed' }));
        throw new Error(err.error || 'Setup failed');
      }
      const data = (await res.json()) as {
        token: string;
        user: {
          id: number;
          username: string;
          displayName: string | null;
          role: string;
        };
      };
      localStorage.setItem('beast_token', data.token);
      localStorage.setItem('beast_user', JSON.stringify(data.user));
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-beast-black">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-600">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <AuthLayout title={t('setup.title')} subtitle={t('setup.subtitle')}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="border-2 border-beast-red/40 bg-beast-red/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="username" className={labelClass}>
            {t('setup.username')}
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            className={inputClass}
            placeholder="admin"
          />
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            {t('setup.password')}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className={labelClass}>
            {t('setup.confirmPassword')}
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-beast-red px-4 py-3.5 text-sm font-bold uppercase tracking-[0.15em] text-white hover:bg-beast-red-hover focus:outline-none focus:ring-2 focus:ring-beast-red/50 focus:ring-offset-2 focus:ring-offset-beast-black transition-colors disabled:opacity-50"
        >
          {loading ? t('setup.creating') : t('setup.create')}
        </button>
      </form>
    </AuthLayout>
  );
}
