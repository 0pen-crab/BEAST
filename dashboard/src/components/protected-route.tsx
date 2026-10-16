import { Navigate, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { useWorkspace } from '@/lib/workspace';
import { isSuperAdmin } from '@/lib/permissions';

export function ProtectedRoute() {
  const { isAuthenticated, user } = useAuth();
  const { needsOnboarding, isLoading, isError, refetchWorkspaces } = useWorkspace();
  const location = useLocation();
  const { t } = useTranslation();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isLoading)
    return (
      <div className="flex h-screen items-center justify-center bg-th-bg">
        <div className="text-th-text-muted text-sm">Loading...</div>
      </div>
    );
  if (isError)
    return (
      <div className="flex h-screen items-center justify-center bg-th-bg">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-th-text">{t('workspace.loadErrorTitle')}</h2>
          <p className="mt-1 text-sm text-th-text-muted">{t('workspace.loadErrorDetail')}</p>
          <button
            type="button"
            className="beast-btn beast-btn-outline beast-btn-sm beast-mt-lg"
            onClick={() => refetchWorkspaces()}
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  if (needsOnboarding) {
    if (user && isSuperAdmin(user.role)) {
      // Already on admin or onboarding route — render it; otherwise redirect to wizard
      if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/onboarding')) {
        return <Outlet />;
      }
      return <Navigate to="/onboarding" replace />;
    }
    return (
      <div className="flex h-screen items-center justify-center bg-th-bg">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-th-text">No workspace assigned</h2>
          <p className="mt-1 text-sm text-th-text-muted">Contact your administrator to get access to a workspace.</p>
        </div>
      </div>
    );
  }
  return <Outlet />;
}
