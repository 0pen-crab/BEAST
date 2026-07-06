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
    useParams: vi.fn(() => ({})),
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
  useClaudeStatus: vi.fn(() => ({ data: { status: 'authenticated' }, isLoading: false })),
  useUpdateAiSettings: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    currentWorkspace: { id: 1, name: 'Test Workspace', description: 'A test workspace', defaultLanguage: 'en', aiAnalysisEnabled: true, aiScanningEnabled: true, aiTriageEnabled: true, aiModelAnalyzer: 'sonnet', aiModelScanner: 'opus', aiModelTriage: 'opus', createdAt: '2026-01-01' },
    workspaces: [{ id: 1, name: 'Test Workspace' }],
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  })),
}));

const { useWorkspace } = await import('@/lib/workspace');
const { canWrite } = await import('@/lib/permissions');
const { useParams } = await import('react-router');

function mockSection(section: 'ai' | 'tools' | undefined) {
  vi.mocked(useParams).mockReturnValue(section ? { section } : {});
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.mocked(useWorkspace).mockReturnValue({
      currentWorkspace: { id: 1, name: 'Test Workspace', description: 'A test workspace', defaultLanguage: 'en', aiAnalysisEnabled: true, aiScanningEnabled: true, aiTriageEnabled: true, aiModelAnalyzer: 'sonnet', aiModelScanner: 'opus', aiModelTriage: 'opus', createdAt: '2026-01-01' },
      workspaces: [{ id: 1, name: 'Test Workspace' }],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    } as any);
    vi.mocked(canWrite).mockReturnValue(true);
    mockSection(undefined);
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

    // SourceForm tabs should appear (single repo / git server / local upload)
    expect(screen.getByText('sources.singleRepo')).toBeInTheDocument();
    expect(screen.getByText('sources.gitServer')).toBeInTheDocument();
    expect(screen.getByText('repos.addRepoUpload')).toBeInTheDocument();
  });

  it('shows source list when sources exist', async () => {
    const { useSources } = await import('@/api/hooks');
    vi.mocked(useSources).mockReturnValue({
      data: [
        { id: 1, provider: 'github', baseUrl: 'https://api.github.com', orgName: 'my-org', orgType: 'organization', workspaceId: 1, syncIntervalMinutes: 1440, lastSyncedAt: null, detectedScopes: [], createdAt: '2026-01-01' },
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
    mockSection('tools');
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

    mockSection('tools');
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('Gitleaks')).toBeInTheDocument();
  });

  it('security tools section hidden for non-admin users', () => {
    vi.mocked(canWrite).mockReturnValue(false);
    mockSection('tools');

    renderWithProviders(<SettingsPage />);

    expect(screen.queryByText('settings.securityTools')).not.toBeInTheDocument();
  });

  // ── AI Capabilities Section ──

  it('renders three AI technique cards', () => {
    mockSection('ai');
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.aiAnalysis')).toBeInTheDocument();
    expect(screen.getByText('settings.aiScanning')).toBeInTheDocument();
    expect(screen.getByText('settings.aiTriage')).toBeInTheDocument();
  });

  it('renders AI technique descriptions', () => {
    mockSection('ai');
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.aiAnalysisDesc')).toBeInTheDocument();
    expect(screen.getByText('settings.aiScanningDesc')).toBeInTheDocument();
    expect(screen.getByText('settings.aiTriageDesc')).toBeInTheDocument();
  });

  it('shows Claude status indicator', () => {
    mockSection('ai');
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.claudeStatus:')).toBeInTheDocument();
    expect(screen.getByText('settings.claudeAuthenticated')).toBeInTheDocument();
  });

  it('shows not authenticated status with hint', async () => {
    const { useClaudeStatus } = await import('@/api/hooks');
    vi.mocked(useClaudeStatus).mockReturnValue({
      data: { status: 'not_authenticated' },
      isLoading: false,
    } as any);
    mockSection('ai');

    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.claudeNotAuthenticated')).toBeInTheDocument();
  });

  it('shows toggle switches for each AI technique', () => {
    mockSection('ai');
    renderWithProviders(<SettingsPage />);

    const toggles = document.querySelectorAll('.beast-toggle');
    // At least 3 toggles for the AI techniques
    expect(toggles.length).toBeGreaterThanOrEqual(3);
  });

  it('AI section hidden for non-admin users', () => {
    vi.mocked(canWrite).mockReturnValue(false);
    mockSection('ai');

    renderWithProviders(<SettingsPage />);

    expect(screen.queryByText('settings.aiAnalysis')).not.toBeInTheDocument();
  });

  it('calls updateAiSettings when toggling AI feature', async () => {
    const mockMutate = vi.fn();
    const { useUpdateAiSettings } = await import('@/api/hooks');
    vi.mocked(useUpdateAiSettings).mockReturnValue({ mutate: mockMutate, isPending: false } as any);
    mockSection('ai');

    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    // Find the first toggle (AI Analysis) and click it
    const toggles = document.querySelectorAll('.beast-ai-card .beast-toggle');
    expect(toggles.length).toBe(3);
    await user.click(toggles[0]);

    expect(mockMutate).toHaveBeenCalledWith(
      { ai_analysis_enabled: false },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  // ── Scan Depth Section ──

  it('renders scan depth preset cards in AI section', () => {
    mockSection('ai');
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('settings.scanDepth.title')).toBeInTheDocument();
    expect(screen.getByText('settings.scanDepth.quick.label')).toBeInTheDocument();
    expect(screen.getByText('settings.scanDepth.standard.label')).toBeInTheDocument();
    expect(screen.getByText('settings.scanDepth.deep.label')).toBeInTheDocument();
  });

  it('standard preset is selected by default', () => {
    mockSection('ai');
    renderWithProviders(<SettingsPage />);

    const standard = screen.getByText('settings.scanDepth.standard.label').closest('.beast-preset-tab');
    expect(standard).toHaveClass('beast-preset-tab-active');
  });

  it('clicking preset card changes selection', async () => {
    mockSection('ai');
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const deepCard = screen.getByText('settings.scanDepth.deep.label').closest('.beast-preset-tab')!;
    await user.click(deepCard);

    expect(deepCard).toHaveClass('beast-preset-tab-active');
  });

  it('persists scan_depth via updateAiSettings when preset clicked', async () => {
    const mockMutate = vi.fn();
    const { useUpdateAiSettings } = await import('@/api/hooks');
    vi.mocked(useUpdateAiSettings).mockReturnValue({ mutate: mockMutate, isPending: false } as any);
    mockSection('ai');

    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const deepCard = screen.getByText('settings.scanDepth.deep.label').closest('.beast-preset-tab')!;
    await user.click(deepCard);

    expect(mockMutate).toHaveBeenCalledWith(
      { scan_depth: 100 },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('reflects workspace.scanDepth on initial render', () => {
    vi.mocked(useWorkspace).mockReturnValue({
      currentWorkspace: { id: 1, name: 'Test Workspace', description: null, defaultLanguage: 'en', aiAnalysisEnabled: true, aiScanningEnabled: true, aiTriageEnabled: true, aiModelAnalyzer: 'sonnet', aiModelScanner: 'opus', aiModelTriage: 'opus', scanDepth: 100, createdAt: '2026-01-01' },
      workspaces: [{ id: 1, name: 'Test Workspace' }],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    } as any);
    mockSection('ai');

    renderWithProviders(<SettingsPage />);

    const deep = screen.getByText('settings.scanDepth.deep.label').closest('.beast-preset-tab');
    expect(deep).toHaveClass('beast-preset-tab-active');
  });
});
