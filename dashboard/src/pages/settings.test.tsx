import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { SettingsPage } from './settings';

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, username: 'admin', displayName: 'Admin User', role: 'admin' },
    logout: vi.fn(),
    token: 'test-token',
    login: vi.fn(),
  })),
}));

vi.mock('@/lib/permissions', () => ({
  useCurrentWorkspaceRole: vi.fn(() => 'workspace_admin'),
  canWrite: vi.fn(() => true),
  isSuperAdmin: vi.fn((role: string) => role === 'super_admin'),
  canManageMembers: vi.fn(() => true),
  canManageWorkspace: vi.fn(() => true),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  };
});

vi.mock('@/api/hooks', () => ({
  useSources: vi.fn(() => ({ data: [], isLoading: false })),
  useSourceRepos: vi.fn(() => ({ data: [], isLoading: false })),
  useConnectSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() })),
  useSyncSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUploadRepoZip: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportFromSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useWorkspaceTools: vi.fn(() => ({ data: [], isLoading: false })),
  useToolRegistry: vi.fn(() => ({ data: [], isLoading: false })),
  useUpdateWorkspaceTools: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useValidateToken: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDisconnectTool: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    currentWorkspace: { id: 1, name: 'Test Workspace', description: 'A test workspace', defaultLanguage: 'en', createdAt: '2026-01-01' },
    workspaces: [{ id: 1, name: 'Test Workspace' }],
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  })),
}));

const { useWorkspace } = await import('@/lib/workspace');
const { canWrite } = await import('@/lib/permissions');

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.mocked(useWorkspace).mockReturnValue({
      currentWorkspace: { id: 1, name: 'Test Workspace', description: 'A test workspace', defaultLanguage: 'en', createdAt: '2026-01-01' },
      workspaces: [{ id: 1, name: 'Test Workspace' }],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    } as any);
    vi.mocked(canWrite).mockReturnValue(true);
  });

  it('renders page title and subtitle', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.title')).toBeInTheDocument();
    expect(screen.getByText('settings.subtitle')).toBeInTheDocument();
  });

  it('renders general settings section', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.general')).toBeInTheDocument();
    expect(screen.getByText('settings.workspaceName')).toBeInTheDocument();
  });

  it('shows workspace name in the input field', () => {
    renderWithProviders(<SettingsPage />);

    const nameInput = screen.getByLabelText('settings.workspaceName');
    expect(nameInput).toHaveValue('Test Workspace');
  });

  it('renders danger zone section', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.dangerZone')).toBeInTheDocument();
    expect(screen.getByText('settings.dangerDesc')).toBeInTheDocument();
  });

  it('allows deleting workspace even when only one exists', () => {
    renderWithProviders(<SettingsPage />);

    const deleteBtn = screen.getByText('settings.deleteWorkspace');
    expect(deleteBtn).not.toBeDisabled();
  });

  it('renders sources section', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('sources.title')).toBeInTheDocument();
    expect(screen.getByText('sources.subtitle')).toBeInTheDocument();
  });

  it('shows add source button', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('sources.addSource')).toBeInTheDocument();
  });

  it('shows no sources message when list is empty', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('sources.noSources')).toBeInTheDocument();
  });

  it('shows save button disabled when no changes', () => {
    renderWithProviders(<SettingsPage />);

    const saveBtn = screen.getByText('settings.saveChanges');
    expect(saveBtn).toBeDisabled();
  });

  it('renders default language dropdown', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('workspace.defaultLanguage')).toBeInTheDocument();
    // LanguageSelect shows the selected language name
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('clicking add source reveals source form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const addBtn = screen.getByText('sources.addSource');
    await user.click(addBtn);

    // SourceForm tabs should appear
    expect(screen.getByText('sources.publicSource')).toBeInTheDocument();
    expect(screen.getByText('repos.addRepoUpload')).toBeInTheDocument();
  });

  it('shows source list when sources exist', async () => {
    const { useSources } = await import('@/api/hooks');
    vi.mocked(useSources).mockReturnValue({
      data: [
        { id: 1, provider: 'github', baseUrl: 'https://api.github.com', orgName: 'my-org', orgType: 'organization', workspaceId: 1, syncIntervalMinutes: 1440, lastSyncedAt: null, prCommentsEnabled: false, detectedScopes: [], webhookSecret: null, webhookId: null, createdAt: '2026-01-01' },
      ],
      isLoading: false,
    } as any);

    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('my-org')).toBeInTheDocument();
    expect(screen.queryByText('sources.noSources')).not.toBeInTheDocument();
  });

  it('renders nothing when currentWorkspace is null', () => {
    vi.mocked(useWorkspace).mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: true,
      refetchWorkspaces: vi.fn(),
    } as any);

    const { container } = renderWithProviders(<SettingsPage />);

    // Should render nothing (return null)
    expect(container.querySelector('.space-y-6')).not.toBeInTheDocument();
  });

  it('renders security tools section', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.securityTools')).toBeInTheDocument();
  });

  it('renders tool cards when registry has data', async () => {
    const { useToolRegistry } = await import('@/api/hooks');
    vi.mocked(useToolRegistry).mockReturnValue({
      data: [
        {
          key: 'gitleaks',
          displayName: 'Gitleaks',
          description: 'Find secrets in code',
          category: 'secrets',
          website: 'https://gitleaks.io',
          credentials: [],
          recommended: true,
          pricing: 'free',
          runnerKey: 'gitleaks',
        },
      ],
      isLoading: false,
    } as any);

    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('Gitleaks')).toBeInTheDocument();
  });

  it('security tools section hidden for non-admin users', () => {
    vi.mocked(canWrite).mockReturnValue(false);

    renderWithProviders(<SettingsPage />);

    expect(screen.queryByText('settings.securityTools')).not.toBeInTheDocument();
  });
});
