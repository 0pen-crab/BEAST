import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import { useAuth } from '@/lib/auth';
import { AuthLayout } from '@/components/auth-layout';

const inputClass =
  'w-full border-2 border-[#2a2a2a] bg-[#0f0f11] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-beast-red focus:outline-none transition-colors font-body';

const labelClass =
  'block text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-400 mb-2';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/auth/setup-status')
      .then((res) => res.json())
      .then((data: { needsSetup: boolean }) => {
        if (data.needsSetup) navigate('/setup', { replace: true });
      })
      .catch((err) => {
        console.error('[login] Setup status check failed:', err);
      });
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title={t('login.signIn')} subtitle={t('login.securityDashboard')}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="border-2 border-beast-red/40 bg-beast-red/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="username" className={labelClass}>
            {t('login.username')}
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            className={inputClass}
            placeholder="Username"
          />
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            {t('login.password')}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputClass}
            placeholder="Password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-beast-red px-4 py-3.5 text-sm font-bold uppercase tracking-[0.15em] text-white hover:bg-beast-red-hover focus:outline-none focus:ring-2 focus:ring-beast-red/50 focus:ring-offset-2 focus:ring-offset-beast-black transition-colors disabled:opacity-50"
        >
          {loading ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </AuthLayout>
  );
}
