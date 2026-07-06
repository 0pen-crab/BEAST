import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { MembersPage } from './members';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.username) return key.replace('{{username}}', params.username);
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    currentWorkspace: { id: 1, name: 'Test Workspace', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' },
    workspaces: [{ id: 1, name: 'Test Workspace' }],
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  })),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, username: 'admin', displayName: 'Admin User', role: 'super_admin' },
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    token: 'test-token',
    mustChangePassword: false,
    clearMustChangePassword: vi.fn(),
  })),
}));

vi.mock('@/api/hooks', () => ({
  useWorkspaceMembers: vi.fn(() => ({ data: [], isLoading: false })),
  useAddWorkspaceMember: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateWorkspaceMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveWorkspaceMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  buildUrl: (path: string, params?: Record<string, string | number | boolean | undefined>) => {
    const url = new URL(path, 'http://localhost');
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  },
}));

const { useWorkspaceMembers, useAddWorkspaceMember, useUpdateWorkspaceMember, useRemoveWorkspaceMember } = await import('@/api/hooks');
const { useAuth } = await import('@/lib/auth');

const mockMembers = [
  {
    id: 1, userId: 1, workspaceId: 1, role: 'workspace_admin' as const,
    createdAt: '2026-01-01T00:00:00Z', username: 'admin', displayName: 'Admin User',
  },
  {
    id: 2, userId: 2, workspaceId: 1, role: 'member' as const,
    createdAt: '2026-02-01T00:00:00Z', username: 'jdoe', displayName: 'John Doe',
  },
];

beforeEach(() => {
  vi.mocked(useWorkspaceMembers).mockReturnValue({ data: [], isLoading: false } as any);
  vi.mocked(useUpdateWorkspaceMember).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, username: 'admin', displayName: 'Admin User', role: 'super_admin' },
    isAuthenticated: true, login: vi.fn(), logout: vi.fn(), token: 'test-token',
    mustChangePassword: false, clearMustChangePassword: vi.fn(),
  } as any);
});

describe('MembersPage', () => {
  it('renders page title', () => {
    renderWithProviders(<MembersPage />);
    expect(screen.getByText('members.title')).toBeInTheDocument();
  });

  it('shows empty state when no members', () => {
    renderWithProviders(<MembersPage />);
    expect(screen.getByText('members.noMembers')).toBeInTheDocument();
  });

  it('shows a table skeleton while loading', () => {
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = renderWithProviders(<MembersPage />);
    expect(container.querySelector('.beast-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
  });

  it('renders member rows when members exist', () => {
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('shows inline add form for admins', () => {
    renderWithProviders(<MembersPage />);
    expect(screen.getByPlaceholderText('members.searchUserPlaceholder')).toBeInTheDocument();
    expect(screen.getByText('members.addMember')).toBeInTheDocument();
  });

  it('hides add form for regular members', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: 'jdoe', displayName: null, role: 'user' },
      isAuthenticated: true,
    } as any);
    vi.mocked(useWorkspaceMembers).mockReturnValue({
      data: [{ id: 2, userId: 2, workspaceId: 1, role: 'member', createdAt: '2026-01-01', username: 'jdoe', displayName: null }],
      isLoading: false,
    } as any);
    renderWithProviders(<MembersPage />);
    expect(screen.queryByPlaceholderText('members.searchUserPlaceholder')).not.toBeInTheDocument();
  });

  it('disables the add button until a user is selected', () => {
    renderWithProviders(<MembersPage />);
    expect(screen.getByText('members.addMember').closest('button')).toBeDisabled();
  });

  it('adds the selected user with the chosen role', async () => {
    const user = userEvent.setup();
    const mockMutateAsync = vi.fn().mockResolvedValue({
      member: { id: 3, userId: 7, workspaceId: 1, role: 'member', username: 'carol@corp.com' },
    });
    vi.mocked(useAddWorkspaceMember).mockReturnValue({ mutateAsync: mockMutateAsync, isPending: false } as any);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 7, username: 'carol@corp.com', displayName: 'Carol' }],
    }) as any;

    renderWithProviders(<MembersPage />);

    // Focusing the picker loads candidates; pick Carol (shown by email) from the dropdown.
    await user.click(screen.getByPlaceholderText('members.searchUserPlaceholder'));
    await user.click(await screen.findByText('carol@corp.com'));

    // Selected chip is shown; submit.
    await user.click(screen.getByText('members.addMember'));

    expect(mockMutateAsync).toHaveBeenCalledWith({
      workspaceId: 1,
      username: 'carol@corp.com',
      role: 'member',
    });
  });

  it('hides remove button on own row', () => {
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);

    // Admin (userId=1) is the current user — only 1 remove button (for jdoe)
    const removeBtns = screen.getAllByText('members.remove');
    expect(removeBtns).toHaveLength(1);
  });

  it('shows inline confirm when remove is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);

    await user.click(screen.getByText('members.remove'));
    expect(screen.getByText('members.yes')).toBeInTheDocument();
    expect(screen.getByText('members.no')).toBeInTheDocument();
  });

  it('calls removeWorkspaceMember when confirm yes is clicked', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    vi.mocked(useRemoveWorkspaceMember).mockReturnValue({ mutate: mockMutate, isPending: false } as any);
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);

    await user.click(screen.getByText('members.remove'));
    await user.click(screen.getByText('members.yes'));

    expect(mockMutate).toHaveBeenCalledWith(
      { workspaceId: 1, userId: 2 },
      expect.any(Object),
    );
  });

  it('cancels removal when no is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);

    await user.click(screen.getByText('members.remove'));
    await user.click(screen.getByText('members.no'));

    // Remove button should be back
    expect(screen.getByText('members.remove')).toBeInTheDocument();
    expect(screen.queryByText('members.yes')).not.toBeInTheDocument();
  });

  it('disables the role select while the role update is pending', () => {
    vi.mocked(useUpdateWorkspaceMember).mockReturnValue({ mutate: vi.fn(), isPending: true } as any);
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);

    for (const select of screen.getAllByLabelText('members.changeRole')) {
      expect(select).toBeDisabled();
    }
  });

  it('keeps the role select enabled when no update is pending', () => {
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);

    for (const select of screen.getAllByLabelText('members.changeRole')) {
      expect(select).toBeEnabled();
    }
  });

  it('renders table headers', () => {
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);
    expect(screen.getByText('members.username')).toBeInTheDocument();
    expect(screen.getByText('members.displayName')).toBeInTheDocument();
    expect(screen.getByText('members.role')).toBeInTheDocument();
    expect(screen.getByText('members.addedAt')).toBeInTheDocument();
    expect(screen.getByText('members.actions')).toBeInTheDocument();
  });
});
