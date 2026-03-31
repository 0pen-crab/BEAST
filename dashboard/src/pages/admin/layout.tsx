import { Outlet, NavLink, useNavigate } from 'react-router';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { isSuperAdmin } from '@/lib/permissions';
import { Topbar } from '@/components/layout/topbar';
import { useState, useEffect } from 'react';

const adminNavItems = [
  { to: '/admin/workspaces', label: 'Workspaces', icon: WorkspacesIcon },
  { to: '/admin/users', label: 'Users', icon: UsersIcon },
];

export function AdminLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Redirect non-super_admin users
  useEffect(() => {
    if (user && !isSuperAdmin(user.role)) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  if (!user || !isSuperAdmin(user.role)) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="beast-sidebar-overlay lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Admin sidebar — same visual style as main Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-row transition-transform lg:static lg:translate-x-0',
          'beast-sidebar',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex flex-1 flex-col min-w-0">
          {/* Brand */}
          <NavLink to="/" className="flex flex-col items-center pt-1">
            <div className="flex items-center gap-5">
              <img
                src={theme === 'light' ? '/beast_kind_small.png' : '/beast_angry_small.png'}
                alt="BEAST"
                className="h-[72px] w-[72px]"
              />
              <span className="beast-sidebar-brand-text">BEAST</span>
            </div>
          </NavLink>

          {/* Admin Console label */}
          <div className="beast-sidebar-divider px-4 py-3">
            <span className="beast-sidebar-section-label">
              Admin Console
            </span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-0.5 px-2 py-3">
            {adminNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'beast-sidebar-nav-item',
                    isActive && 'beast-sidebar-nav-item-active',
                  )
                }
              >
                <item.icon />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Back to workspace */}
          <div className="beast-sidebar-divider p-3">
            <NavLink
              to="/"
              className="beast-sidebar-nav-item"
            >
              <BackIcon />
              Back to workspace
            </NavLink>
          </div>

          {/* Footer */}
          <div className="beast-sidebar-divider px-4 py-3">
            <p className="beast-sidebar-footer">BEAST v0.1.0</p>
          </div>
        </div>

        {/* Red gradient separator line on right edge */}
        <div className="beast-sidebar-gradient" />
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function WorkspacesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5" height="5" rx="0" />
      <rect x="9" y="2" width="5" height="5" rx="0" />
      <rect x="2" y="9" width="5" height="5" rx="0" />
      <rect x="9" y="9" width="5" height="5" rx="0" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <path d="M11 7.5a2 2 0 1 0 0-4" />
      <path d="M12.5 13c0-2 1-3 2-3.5" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}
