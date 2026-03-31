import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { AppLayout } from './app-layout';

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, username: 'admin', displayName: null, role: 'super_admin' },
    isAuthenticated: true,
    mustChangePassword: false,
    clearMustChangePassword: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    token: 'test-token',
  })),
}));

vi.mock('@/api/hooks', () => ({
  useChangePassword: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Mock child components to isolate AppLayout
vi.mock('./sidebar', () => ({
  Sidebar: (props: { open: boolean }) => (
    <div data-testid="sidebar" data-open={props.open}>
      Sidebar
    </div>
  ),
}));

vi.mock('./topbar', () => ({
  Topbar: (props: { onMenuClick: () => void }) => (
    <div data-testid="topbar">
      <button data-testid="menu-btn" onClick={props.onMenuClick}>
        Menu
      </button>
    </div>
  ),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet">Page Content</div>,
  };
});

describe('AppLayout', () => {
  it('renders sidebar, topbar, and outlet', () => {
    renderWithProviders(<AppLayout />);

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('sidebar starts closed', () => {
    renderWithProviders(<AppLayout />);

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');
  });

  it('opens sidebar when menu button is clicked', () => {
    renderWithProviders(<AppLayout />);

    fireEvent.click(screen.getByTestId('menu-btn'));

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'true');
  });

  it('renders main content area', () => {
    renderWithProviders(<AppLayout />);

    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
