import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { Sidebar } from './sidebar';

// Mock auth
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, username: 'admin', displayName: 'Admin User', role: 'admin' },
    logout: vi.fn(),
    token: 'test-token',
    login: vi.fn(),
  })),
}));

// Mock hooks
vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    workspaces: [{ id: 1, name: 'Test WS', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' }],
    currentWorkspace: { id: 1, name: 'Test WS', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' },
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  })),
}));

vi.mock('@/api/hooks', () => ({
  useScanEventStats: vi.fn(() => ({ data: { unresolved: 0 } })),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: vi.fn(() => ({ theme: 'dark', setTheme: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'nav.dashboard': 'Dashboard',
        'nav.scans': 'Scans',
        'nav.repos': 'Repositories',
        'nav.events': 'Events',
        'nav.findings': 'Findings',
        'nav.contributors': 'Contributors',
        'nav.teams': 'Teams',
        'nav.members': 'Members',
        'nav.settings': 'Settings',
        'brand.tagline': 'Security Scanner',
        'workspace.select': 'Select workspace',
        'workspace.create': 'Create workspace',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

describe('Sidebar', () => {
  const defaultProps = { open: false, onClose: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    renderWithProviders(<Sidebar {...defaultProps} />);
    expect(screen.getByText('BEAST')).toBeInTheDocument();
  });

  it('renders all navigation links', () => {
    renderWithProviders(<Sidebar {...defaultProps} />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Scans')).toBeInTheDocument();
    expect(screen.getByText('Repositories')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Findings')).toBeInTheDocument();
    expect(screen.getByText('Contributors')).toBeInTheDocument();
    expect(screen.getByText('Teams')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders the BEAST brand name', () => {
    renderWithProviders(<Sidebar {...defaultProps} />);
    expect(screen.getByText('BEAST')).toBeInTheDocument();
  });

  it('renders version footer', () => {
    renderWithProviders(<Sidebar {...defaultProps} />);
    expect(screen.getByText(`BEAST v${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it('renders workspace switcher with current workspace name', () => {
    renderWithProviders(<Sidebar {...defaultProps} />);
    expect(screen.getByText('Test WS')).toBeInTheDocument();
  });

  it('does not show event badge when unresolved count is 0', () => {
    renderWithProviders(<Sidebar {...defaultProps} />);
    // No badge should be rendered
    const badges = screen.queryAllByText(/^\d+$/);
    expect(badges).toHaveLength(0);
  });

  it('shows event badge when unresolved count > 0', async () => {
    const { useScanEventStats } = await import('@/api/hooks');
    (useScanEventStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { unresolved: 5 },
    });

    renderWithProviders(<Sidebar {...defaultProps} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows 99+ when unresolved count exceeds 99', async () => {
    const { useScanEventStats } = await import('@/api/hooks');
    (useScanEventStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { unresolved: 150 },
    });

    renderWithProviders(<Sidebar {...defaultProps} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('navigation links have correct href targets', () => {
    renderWithProviders(<Sidebar {...defaultProps} />);

    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveAttribute('href', '/');

    const scansLink = screen.getByText('Scans').closest('a');
    expect(scansLink).toHaveAttribute('href', '/scans');

    const findingsLink = screen.getByText('Findings').closest('a');
    expect(findingsLink).toHaveAttribute('href', '/findings');

    const teamsLink = screen.getByText('Teams').closest('a');
    expect(teamsLink).toHaveAttribute('href', '/teams');

    const settingsLink = screen.getByText('Settings').closest('a');
    expect(settingsLink).toHaveAttribute('href', '/settings');
  });

  it('does not show create workspace button for non-super_admin users', async () => {
    const { useAuth } = await import('@/lib/auth');
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
      user: { id: 1, username: 'admin', displayName: 'Admin User', role: 'admin' },
      logout: vi.fn(),
      token: 'test-token',
      login: vi.fn(),
    });

    renderWithProviders(<Sidebar {...defaultProps} />);
    // Open dropdown to see workspace list
    fireEvent.click(screen.getByText('Test WS'));
    expect(screen.queryByText('Create workspace')).not.toBeInTheDocument();
  });

  it('shows create workspace button for super_admin users navigating to /onboarding', async () => {
    const { useAuth } = await import('@/lib/auth');
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
      user: { id: 1, username: 'superadmin', displayName: 'Super Admin', role: 'super_admin' },
      logout: vi.fn(),
      token: 'test-token',
      login: vi.fn(),
    });

    renderWithProviders(<Sidebar {...defaultProps} />);
    // Open dropdown to see workspace list
    fireEvent.click(screen.getByText('Test WS'));
    expect(screen.getByText('Create workspace')).toBeInTheDocument();
  });
});
