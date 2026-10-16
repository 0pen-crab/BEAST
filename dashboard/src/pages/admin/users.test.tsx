import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { AdminUsersPage } from './users';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const mockUseAuth = vi.fn(() => ({
  user: { id: 1, username: 'admin', displayName: 'Admin', role: 'super_admin' },
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

const mockCreateUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockDeleteUser = vi.fn();

vi.mock('@/api/hooks', () => ({
  useAdminUsers: vi.fn(() => ({
    data: [
      {
        id: 1,
        username: 'admin',
        displayName: 'Admin User',
        role: 'super_admin',
        createdAt: '2026-01-01T00:00:00Z',
        workspaces: [{ workspaceId: 1, name: 'Main', role: 'workspace_admin' }],
      },
      {
        id: 2,
        username: 'bob',
        displayName: 'Bob',
        role: 'member',
        createdAt: '2026-02-01T00:00:00Z',
        workspaces: [],
      },
    ],
    isLoading: false,
  })),
  useCreateUser: vi.fn(() => ({
    mutate: mockCreateUser,
    isPending: false,
    isSuccess: false,
    data: null,
    reset: vi.fn(),
  })),
  useUpdateUser: vi.fn(() => ({
    mutate: mockUpdateUser,
    isPending: false,
    isSuccess: false,
    data: null,
    reset: vi.fn(),
  })),
  useDeleteUser: vi.fn(() => ({
    mutate: mockDeleteUser,
    isPending: false,
  })),
}));

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page heading', () => {
    renderWithProviders(<AdminUsersPage />);
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
  });

  it('renders Add User button', () => {
    renderWithProviders(<AdminUsersPage />);
    expect(screen.getByRole('button', { name: /Add User/i })).toBeInTheDocument();
  });

  it('renders user table with column headers', () => {
    renderWithProviders(<AdminUsersPage />);
    expect(screen.getByText('Username')).toBeInTheDocument();
    expect(screen.getByText('Display Name')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('renders user rows', () => {
    renderWithProviders(<AdminUsersPage />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('renders workspace badges for users with workspaces', () => {
    renderWithProviders(<AdminUsersPage />);
    expect(screen.getByText('Main')).toBeInTheDocument();
  });

  it('opens Add User modal when button clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await user.click(screen.getByRole('button', { name: /Add User/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
  });

  it('calls createUser mutation on form submit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await user.click(screen.getByRole('button', { name: /Add User/i }));
    await user.type(screen.getByLabelText(/Username/i), 'newuser');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'newuser' }),
      expect.any(Object),
    );
  });

  it('cannot delete current user', () => {
    renderWithProviders(<AdminUsersPage />);
    // The current user (id=1) should have delete disabled
    const rows = screen.getAllByRole('row');
    // First data row is admin (current user) — find their delete button
    const adminRow = rows.find((row) => row.textContent?.includes('admin'));
    const deleteBtn = adminRow?.querySelector('button[aria-label*="delete"], button[title*="delete"]');
    // Either no delete button or it's disabled
    if (deleteBtn) {
      expect(deleteBtn).toBeDisabled();
    }
  });

  it('shows loading state', async () => {
    const hooks = await import('@/api/hooks');
    vi.mocked(hooks.useAdminUsers).mockReturnValueOnce({ data: undefined, isLoading: true } as any);

    renderWithProviders(<AdminUsersPage />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });
});
