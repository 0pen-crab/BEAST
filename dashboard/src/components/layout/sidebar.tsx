import { NavLink, useNavigate } from 'react-router';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useScanEventStats } from '@/api/hooks';
import { useWorkspace } from '@/lib/workspace';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { isSuperAdmin } from '@/lib/permissions';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const navItems = [
  { to: '/', labelKey: 'nav.dashboard', icon: DashboardIcon },
  { to: '/repos', labelKey: 'nav.repositories', icon: ReposIcon },
  { to: '/scans', labelKey: 'nav.scans', icon: ScansIcon },
  { to: '/findings', labelKey: 'nav.findings', icon: FindingsIcon },
  { to: '/events', labelKey: 'nav.events', icon: EventsIcon, badge: true },
  { to: '/contributors', labelKey: 'nav.contributors', icon: ContributorsIcon },
  { to: '/teams', labelKey: 'nav.teams', icon: TeamsIcon },
  { to: '/members', labelKey: 'nav.members', icon: MembersIcon },
  { to: '/settings', labelKey: 'nav.settings', icon: SettingsIcon },
];

export function Sidebar({ open, onClose }: SidebarProps) {
  const { data: eventStats } = useScanEventStats();
  const unresolvedCount = eventStats?.unresolved ?? 0;
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-60 flex-row transition-transform lg:static lg:translate-x-0',
        'bg-sidebar',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      {/* Main sidebar content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Brand — login page style */}
        <NavLink to="/" onClick={onClose} className="flex flex-col items-center pt-1">
          <div className="flex items-center gap-5">
            <img src={theme === 'light' ? '/beast_kind_small.png' : '/beast_angry_small.png'} alt="BEAST" className="h-[72px] w-[72px]" />
            <span
              className="text-[42px] leading-[0.85] tracking-[0.08em] text-beast-red"
              style={{ fontFamily: "'Anton', sans-serif" }}
            >
              BEAST
            </span>
          </div>
        </NavLink>

        {/* Workspace Switcher */}
        <WorkspaceSwitcher />

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-3 py-[7px] text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-white/10 text-white border-l-2 border-beast-red'
                    : 'text-[#ababad] hover:bg-white/[0.06] hover:text-white border-l-2 border-transparent',
                )
              }
            >
              <item.icon />
              {t(item.labelKey)}
              {'badge' in item && item.badge && unresolvedCount > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center bg-beast-red px-1.5 text-[10px] font-bold text-white">
                  {unresolvedCount > 99 ? '99+' : unresolvedCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 px-4 py-3">
          <p className="text-[10px] text-[#616061]">BEAST v0.1.0</p>
        </div>
      </div>

      {/* Red gradient separator line on right edge */}
      <div
        className="w-[2px] shrink-0"
        style={{ background: 'linear-gradient(to bottom, #dc2626, #b91c1c, transparent)' }}
      />
    </aside>
  );
}

function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaces, currentWorkspace, switchWorkspace } =
    useWorkspace();
  const { user } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  return (
    <div ref={ref} className="relative px-2 pb-2">
      {/* Trigger */}
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-white hover:bg-white/[0.06] transition-colors border border-white/10"
      >
        <span className="flex h-5 w-5 items-center justify-center bg-beast-red text-[10px] font-bold text-white shrink-0">
          {currentWorkspace?.name?.charAt(0).toUpperCase() ?? 'W'}
        </span>
        <span className="truncate flex-1">
          {currentWorkspace?.name ?? t('workspace.select')}
        </span>
        <ChevronIcon open={dropdownOpen} />
      </button>

      {/* Dropdown */}
      {dropdownOpen && (
        <div className="absolute left-2 right-2 top-full z-50 mt-1 border border-white/10 bg-[#1a1a1c] shadow-xl overflow-hidden">
          {/* Workspace list */}
          <div className="max-h-48 overflow-y-auto py-1">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => {
                  switchWorkspace(ws.id);
                  setDropdownOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors',
                  ws.id === currentWorkspace?.id
                    ? 'bg-white/10 text-white'
                    : 'text-[#ababad] hover:bg-white/[0.06] hover:text-white',
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center bg-beast-red/80 text-[10px] font-bold text-white shrink-0">
                  {ws.name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{ws.name}</span>
                {ws.id === currentWorkspace?.id && (
                  <CheckIcon />
                )}
              </button>
            ))}
          </div>

          {/* Divider + Create */}
          {user && isSuperAdmin(user.role) && (
            <div className="border-t border-white/10 p-1">
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  navigate('/onboarding');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#ababad] hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                <PlusIcon />
                {t('workspace.create')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0 text-[#ababad] transition-transform', open && 'rotate-180')}
    >
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0 text-beast-red">
      <path d="M3 7l3 3 5-5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="shrink-0">
      <path d="M7 3v8M3 7h8" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5" height="5" rx="0" />
      <rect x="9" y="2" width="5" height="5" rx="0" />
      <rect x="2" y="9" width="5" height="5" rx="0" />
      <rect x="9" y="9" width="5" height="5" rx="0" />
    </svg>
  );
}

function ReposIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h4l2 2h6v8H2V3z" />
    </svg>
  );
}

function FindingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2L2 5v4c0 3.5 2.5 5.5 6 7 3.5-1.5 6-3.5 6-7V5L8 2z" />
      <path d="M6 8l2 2 3-3" />
    </svg>
  );
}

function ScansIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8A5 5 0 1 1 8 3" />
      <path d="M8 8l3-5" />
      <path d="M13 3v3h-3" />
    </svg>
  );
}

function EventsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5L1.5 13.5h13L8 1.5z" />
      <path d="M8 6v3" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ContributorsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="4.5" r="2.5" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </svg>
  );
}

function TeamsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="11" cy="6" r="2" />
      <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <path d="M10.5 9c1.5 0 3.5 1 3.5 3" />
    </svg>
  );
}

function MembersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <path d="M11 7.5a2 2 0 1 0 0-4" />
      <path d="M12.5 13c0-2 1-3 2-3.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M13.5 8a5.5 5.5 0 0 0-.1-.9l1.3-1-.7-1.2-1.5.5a5.3 5.3 0 0 0-1.6-.9L10.5 3h-1.4l-.4 1.5c-.6.2-1.1.5-1.6.9L5.6 4.9l-.7 1.2 1.3 1a5.5 5.5 0 0 0 0 1.8l-1.3 1 .7 1.2 1.5-.5c.5.4 1 .7 1.6.9L9.1 13h1.4l.4-1.5c.6-.2 1.1-.5 1.6-.9l1.5.5.7-1.2-1.3-1c.1-.3.1-.6.1-.9z" />
    </svg>
  );
}

