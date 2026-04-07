import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { isSuperAdmin } from '@/lib/permissions';
import { setLanguage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { BeastAcronym } from '@/components/beast-acronym';
import { RateLimitNotice } from './rate-limit-banner';

interface TopbarProps {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const currentLang = i18n.language;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-th-topbar-border bg-th-topbar-bg pr-5" style={{ height: '77px', paddingLeft: '10px' }}>
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="p-1.5 text-th-text-muted hover:bg-th-hover lg:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>

      {/* Stacked acronym — login page style */}
      <div className="hidden lg:block">
        <BeastAcronym size="md" restColor="text-[#777]" />
      </div>

      {/* Center: alerts area */}
      <RateLimitNotice />

      {/* User menu */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className={cn(
            'flex items-center gap-2.5 px-3 py-2 transition-colors border',
            menuOpen ? 'border-th-border bg-th-hover' : 'border-transparent hover:border-th-border',
          )}
        >
          <div className="flex h-7 w-7 items-center justify-center bg-beast-red/15 text-xs font-bold text-beast-red">
            {(user?.displayName ?? user?.username)?.charAt(0).toUpperCase() ?? 'U'}
          </div>
          <span className="text-[13px] font-medium text-th-text hidden sm:inline">
            {user?.displayName ?? user?.username}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={cn('text-th-text-muted transition-transform', menuOpen && 'rotate-180')}>
            <path d="M2.5 3.75l2.5 2.5 2.5-2.5" />
          </svg>
        </button>

        {/* Dropdown */}
        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-56 border border-th-border bg-th-surface">
            {/* User info */}
            <div className="px-4 py-3 border-b border-th-border-subtle">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center bg-beast-red/15 text-sm font-bold text-beast-red">
                  {(user?.displayName ?? user?.username)?.charAt(0).toUpperCase() ?? 'U'}
                </div>
                <div>
                  <div className="text-sm font-medium text-th-text">{user?.displayName ?? user?.username}</div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-th-text-muted">
                    {user?.role === 'super_admin' ? 'Super Admin' : user?.role ?? 'User'}
                  </div>
                </div>
              </div>
            </div>

            {/* Language */}
            <div className="px-4 py-2.5 border-b border-th-border-subtle flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.12em] text-th-text-muted font-semibold">
                {t('topbar.language', 'Language')}
              </span>
              <div className="flex border border-th-border">
                <button
                  onClick={() => setLanguage('en')}
                  className={cn(
                    'px-2 py-1 text-[14px] leading-none transition-colors',
                    currentLang === 'en' ? 'bg-beast-red/10' : 'hover:bg-th-hover',
                  )}
                >
                  🇬🇧
                </button>
                <button
                  onClick={() => setLanguage('uk')}
                  className={cn(
                    'px-2 py-1 text-[14px] leading-none transition-colors',
                    currentLang === 'uk' ? 'bg-beast-red/10' : 'hover:bg-th-hover',
                  )}
                >
                  🇺🇦
                </button>
              </div>
            </div>

            {/* Theme */}
            <div className="px-4 py-2.5 border-b border-th-border-subtle flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.12em] text-th-text-muted font-semibold">
                {t('topbar.theme', 'Theme')}
              </span>
              <div className="flex border border-th-border">
                <button
                  onClick={toggleTheme}
                  className={cn(
                    'px-2 py-1 text-[14px] leading-none transition-colors',
                    theme === 'light' ? 'bg-beast-red/10' : 'hover:bg-th-hover',
                  )}
                >
                  ☀
                </button>
                <button
                  onClick={toggleTheme}
                  className={cn(
                    'px-2 py-1 text-[14px] leading-none transition-colors',
                    theme === 'dark' ? 'bg-beast-red/10' : 'hover:bg-th-hover',
                  )}
                >
                  🌙
                </button>
              </div>
            </div>

            {/* Admin link */}
            {user && isSuperAdmin(user.role) && (
              <NavLink
                to="/admin"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-th-text-muted hover:bg-th-hover hover:text-beast-red transition-colors border-b border-th-border-subtle"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="2" />
                  <path d="M13.5 8a5.5 5.5 0 0 0-.1-.9l1.3-1-.7-1.2-1.5.5a5.3 5.3 0 0 0-1.6-.9L10.5 3h-1.4l-.4 1.5c-.6.2-1.1.5-1.6.9L5.6 4.9l-.7 1.2 1.3 1a5.5 5.5 0 0 0 0 1.8l-1.3 1 .7 1.2 1.5-.5c.5.4 1 .7 1.6.9L9.1 13h1.4l.4-1.5c.6-.2 1.1-.5 1.6-.9l1.5.5.7-1.2-1.3-1c.1-.3.1-.6.1-.9z" />
                </svg>
                Admin Console
              </NavLink>
            )}

            {/* Sign out */}
            <button
              onClick={() => { setMenuOpen(false); logout(); }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-beast-red hover:bg-beast-red/10 transition-colors font-semibold"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 14H3V2h3" />
                <path d="M10 12l4-4-4-4" />
                <path d="M14 8H6" />
              </svg>
              {t('topbar.signOut')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
