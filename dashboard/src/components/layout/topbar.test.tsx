import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { Topbar } from './topbar';

// Mock auth
const mockLogout = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, username: 'admin', displayName: 'Admin User', role: 'admin' },
    logout: mockLogout,
    token: 'test-token',
    login: vi.fn(),
  })),
}));

// Mock theme
const mockToggleTheme = vi.fn();
vi.mock('@/lib/theme', () => ({
  useTheme: vi.fn(() => ({
    theme: 'dark',
    setTheme: vi.fn(),
    toggleTheme: mockToggleTheme,
  })),
}));

// Mock permissions
vi.mock('@/lib/permissions', () => ({
  isSuperAdmin: vi.fn((role: string) => role === 'super_admin'),
}));

// Mock i18n
const mockSetLanguage = vi.fn();
vi.mock('@/lib/i18n', () => ({
  setLanguage: (...args: unknown[]) => mockSetLanguage(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'topbar.signOut': 'Sign out',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

/** Helper: open the user dropdown menu by clicking the user button */
function openUserMenu() {
  // The user menu button contains the display name text
  const userButton = screen.getByText('Admin User').closest('button')!;
  fireEvent.click(userButton);
}

describe('Topbar', () => {
  const onMenuClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    expect(screen.getByText('Admin User')).toBeInTheDocument();
  });

  it('displays the user display name', () => {
    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    expect(screen.getByText('Admin User')).toBeInTheDocument();
  });

  it('displays user avatar initial from displayName', () => {
    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    // The avatar initial is inside a div with specific class, not a span
    const avatars = screen.getAllByText('A');
    const avatarDiv = avatars.find(el =>
      el.classList.contains('text-beast-red') && el.tagName === 'DIV',
    );
    expect(avatarDiv).toBeTruthy();
  });

  it('renders sign out button inside dropdown', () => {
    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    openUserMenu();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('renders language toggle buttons inside dropdown', () => {
    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    openUserMenu();
    // Language buttons are emoji flags inside the dropdown
    expect(screen.getByText('\u{1F1EC}\u{1F1E7}')).toBeInTheDocument(); // GB flag
    expect(screen.getByText('\u{1F1FA}\u{1F1E6}')).toBeInTheDocument(); // UA flag
  });

  it('calls logout when sign out button is clicked', () => {
    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    openUserMenu();
    fireEvent.click(screen.getByText('Sign out'));

    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it('calls setLanguage when language button is clicked', () => {
    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    openUserMenu();
    fireEvent.click(screen.getByText('\u{1F1FA}\u{1F1E6}')); // UA flag

    expect(mockSetLanguage).toHaveBeenCalledWith('uk');
  });

  it('calls onMenuClick when hamburger menu button is clicked', () => {
    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    // The hamburger button is the first button in the header (for mobile)
    const header = screen.getByRole('banner');
    const buttons = header.querySelectorAll('button');
    // First button is the hamburger menu
    fireEvent.click(buttons[0]);

    expect(onMenuClick).toHaveBeenCalledOnce();
  });

  it('falls back to username when displayName is null', async () => {
    const { useAuth } = await import('@/lib/auth');
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
      user: { id: 1, username: 'testuser', displayName: null, role: 'admin' },
      logout: mockLogout,
      token: 'test-token',
      login: vi.fn(),
    });

    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    expect(screen.getByText('testuser')).toBeInTheDocument();
    // Avatar initial should be 'T' from 'testuser'
    const avatars = screen.getAllByText('T');
    const avatarDiv = avatars.find(el =>
      el.classList.contains('text-beast-red') && el.tagName === 'DIV',
    );
    expect(avatarDiv).toBeTruthy();
  });

  it('does not show Admin link for non-super_admin users', async () => {
    // Restore mock explicitly since a previous test may have changed it
    const { useAuth } = await import('@/lib/auth');
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
      user: { id: 1, username: 'admin', displayName: 'Admin User', role: 'admin' },
      logout: mockLogout,
      token: 'test-token',
      login: vi.fn(),
    });

    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    openUserMenu();
    expect(screen.queryByText('Admin Console')).not.toBeInTheDocument();
  });

  it('shows Admin link for super_admin users linking to /admin', async () => {
    const { useAuth } = await import('@/lib/auth');
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
      user: { id: 1, username: 'superadmin', displayName: 'Super Admin', role: 'super_admin' },
      logout: mockLogout,
      token: 'test-token',
      login: vi.fn(),
    });

    renderWithProviders(<Topbar onMenuClick={onMenuClick} />);
    // Open the dropdown menu
    const userButton = screen.getByText('Super Admin').closest('button')!;
    fireEvent.click(userButton);

    const adminLink = screen.getByRole('link', { name: /Admin Console/i });
    expect(adminLink).toBeInTheDocument();
    expect(adminLink).toHaveAttribute('href', '/admin');
  });
});
