import { Outlet, useLocation } from 'react-router';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { useChangePassword } from '@/api/hooks';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { mustChangePassword, clearMustChangePassword } = useAuth();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-th-bg">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-6">
            {mustChangePassword ? (
              <PasswordChangeGate onDone={clearMustChangePassword} />
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function PasswordChangeGate({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const changePassword = useChangePassword();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    if (newPassword.length < 6) {
      setError(t('auth.passwordTooShort'));
      return;
    }

    try {
      await changePassword.mutateAsync({ newPassword });
      onDone();
    } catch (err: any) {
      setError(err.message || t('common.error'));
    }
  }

  return (
    <div className="beast-stack-md beast-narrow-center">
      <div className="beast-page-header">
        <h1 className="beast-page-title">{t('auth.changePassword')}</h1>
      </div>
      <p className="beast-page-subtitle">{t('auth.mustChangePassword')}</p>

      {error && <div className="beast-error">{error}</div>}

      <form onSubmit={handleSubmit} className="beast-stack">
        <div>
          <label className="beast-label">{t('auth.newPassword')}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="beast-input"
            minLength={6}
            required
          />
        </div>
        <div>
          <label className="beast-label">{t('auth.confirmPassword')}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="beast-input"
            minLength={6}
            required
          />
        </div>
        <button
          type="submit"
          disabled={changePassword.isPending}
          className="beast-btn beast-btn-primary"
        >
          {changePassword.isPending ? t('common.loading') : t('auth.changePassword')}
        </button>
      </form>
    </div>
  );
}
