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
}));

const { useWorkspaceMembers, useAddWorkspaceMember, useRemoveWorkspaceMember } = await import('@/api/hooks');
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

  it('shows loading state', () => {
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: undefined, isLoading: true } as any);
    renderWithProviders(<MembersPage />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('renders member rows when members exist', () => {
    vi.mocked(useWorkspaceMembers).mockReturnValue({ data: mockMembers, isLoading: false } as any);
    renderWithProviders(<MembersPage />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('shows inline add form for admins', () => {
    renderWithProviders(<MembersPage />);
    expect(screen.getByPlaceholderText('members.usernamePlaceholder')).toBeInTheDocument();
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
    expect(screen.queryByPlaceholderText('members.usernamePlaceholder')).not.toBeInTheDocument();
  });

  it('shows success banner with password after adding new user', async () => {
    const user = userEvent.setup();
    const mockMutateAsync = vi.fn().mockResolvedValue({
      member: { id: 3, userId: 3, workspaceId: 1, role: 'member', username: 'new@test.com' },
      generatedPassword: 'TempPw12',
    });
    vi.mocked(useAddWorkspaceMember).mockReturnValue({ mutateAsync: mockMutateAsync, isPending: false } as any);

    renderWithProviders(<MembersPage />);

    await user.type(screen.getByPlaceholderText('members.usernamePlaceholder'), 'new@test.com');
    await user.click(screen.getByText('members.addMember'));

    expect(await screen.findByText('TempPw12')).toBeInTheDocument();
    expect(screen.getByText('members.copyCredentials')).toBeInTheDocument();
  });

  it('does not show password banner when adding existing user', async () => {
    const user = userEvent.setup();
    const mockMutateAsync = vi.fn().mockResolvedValue({
      member: { id: 3, userId: 5, workspaceId: 1, role: 'member', username: 'existing' },
    });
    vi.mocked(useAddWorkspaceMember).mockReturnValue({ mutateAsync: mockMutateAsync, isPending: false } as any);

    renderWithProviders(<MembersPage />);

    await user.type(screen.getByPlaceholderText('members.usernamePlaceholder'), 'existing');
    await user.click(screen.getByText('members.addMember'));

    expect(screen.queryByText('members.tempPassword')).not.toBeInTheDocument();
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
