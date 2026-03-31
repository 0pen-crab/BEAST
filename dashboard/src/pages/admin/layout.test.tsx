import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { AdminLayout } from './layout';

const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: vi.fn(() => mockNavigate),
    Outlet: () => <div data-testid="outlet" />,
    NavLink: ({ to, children, className }: { to: string; children: React.ReactNode; className: any }) => {
      const cls = typeof className === 'function' ? className({ isActive: false }) : className;
      return <a href={to} className={cls}>{children}</a>;
    },
  };
});

vi.mock('@/lib/permissions', () => ({
  isSuperAdmin: vi.fn((role: string) => role === 'super_admin'),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: vi.fn(() => ({ theme: 'dark', toggleTheme: vi.fn() })),
}));

vi.mock('@/components/layout/topbar', () => ({
  Topbar: ({ onMenuClick }: { onMenuClick: () => void }) => (
    <header data-testid="topbar">
      <button onClick={onMenuClick}>menu</button>
    </header>
  ),
}));

const mockUseAuth = vi.fn(() => ({
  user: { id: 1, username: 'admin', displayName: null, role: 'super_admin' },
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

describe('AdminLayout', () => {
  it('renders Topbar component', () => {
    renderWithProviders(<AdminLayout />);
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
  });

  it('renders Admin Console label', () => {
    renderWithProviders(<AdminLayout />);
    expect(screen.getByText('Admin Console')).toBeInTheDocument();
  });

  it('renders admin nav links', () => {
    renderWithProviders(<AdminLayout />);
    expect(screen.getByRole('link', { name: /Workspaces/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Users/ })).toBeInTheDocument();
  });

  it('renders Back to workspace link', () => {
    renderWithProviders(<AdminLayout />);
    expect(screen.getByText(/Back to workspace/)).toBeInTheDocument();
  });

  it('renders outlet for page content', () => {
    renderWithProviders(<AdminLayout />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders nothing when user is not super_admin', () => {
    mockUseAuth.mockReturnValueOnce({
      user: { id: 2, username: 'user', displayName: null, role: 'member' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
    });

    const { container } = renderWithProviders(<AdminLayout />);
    expect(container.innerHTML).toBe('');
  });

  it('redirects non-super_admin users to /', () => {
    mockUseAuth.mockReturnValueOnce({
      user: { id: 2, username: 'user', displayName: null, role: 'member' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
    });

    renderWithProviders(<AdminLayout />);
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
