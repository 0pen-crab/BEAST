import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { OnboardingPage } from './onboarding';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const mockUseAuth = vi.fn(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  isAuthenticated: true,
  token: 'test-token',
  user: { id: 1, username: 'admin', displayName: null, role: 'admin' },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: vi.fn(() => ({ theme: 'dark', setTheme: vi.fn() })),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    currentWorkspace: null,
    workspaces: [],
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: true,
    refetchWorkspaces: vi.fn(),
  })),
}));

const { useWorkspace } = await import('@/lib/workspace');

vi.mock('@/api/hooks', () => ({
  useConnectSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUploadRepoZip: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportFromSource: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useSources: vi.fn(() => ({ data: [], isLoading: false })),
  useDeleteSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToolRegistry: vi.fn(() => ({ data: [], isLoading: false })),
  useUpdateWorkspaceTools: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useValidateToken: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

describe('OnboardingPage', () => {
  it('renders step 1 with workspace creation form', () => {
    renderWithProviders(<OnboardingPage />);

    expect(screen.getByRole('heading', { name: 'onboarding.title' })).toBeInTheDocument();
    expect(screen.getByLabelText(/onboarding.workspaceName/)).toBeInTheDocument();
  });

  it('renders 4-step progress indicator', () => {
    renderWithProviders(<OnboardingPage />);

    expect(screen.getByText('onboarding.step1')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step2')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step3')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step4')).toBeInTheDocument();
  });

  it('renders the create workspace button', () => {
    renderWithProviders(<OnboardingPage />);

    expect(screen.getByRole('button', { name: 'onboarding.createWorkspace' })).toBeInTheDocument();
  });

  it('step 1 shows workspace name input and language selector', () => {
    renderWithProviders(<OnboardingPage />);

    expect(screen.getByLabelText(/onboarding.workspaceName/)).toBeInTheDocument();
    expect(screen.getByLabelText(/onboarding.description/)).toBeInTheDocument();
    // LanguageSelect dropdown shows the selected language name
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('shows "add" title when workspaces already exist', () => {
    vi.mocked(useWorkspace).mockReturnValueOnce({
      currentWorkspace: { id: 1, name: 'Existing', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' },
      workspaces: [{ id: 1, name: 'Existing' }],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    renderWithProviders(<OnboardingPage />);

    expect(screen.getByRole('heading', { name: 'onboarding.titleAdd' })).toBeInTheDocument();
  });

  it('step 1 does not show source form, tool config, or import controls', () => {
    renderWithProviders(<OnboardingPage />);

    // SourceForm tabs should not be visible on step 1
    expect(screen.queryByText('sources.publicSource')).not.toBeInTheDocument();
    // Tool config should not be visible on step 1
    expect(screen.queryByText('onboarding.toolsTitle')).not.toBeInTheDocument();
    // Import controls should not be visible
    expect(screen.queryByText('repoPicker.importAll')).not.toBeInTheDocument();
  });

  it('shows tool config step after workspace creation', async () => {
    const user = userEvent.setup();

    // Mock the fetch call for workspace creation
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 42, name: 'Test Workspace' }),
    });

    // Mock refetchWorkspaces
    const refetchWorkspaces = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useWorkspace).mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: true,
      refetchWorkspaces,
    });

    renderWithProviders(<OnboardingPage />);

    // Fill in workspace name and submit
    const nameInput = screen.getByLabelText(/onboarding.workspaceName/);
    await user.type(nameInput, 'Test Workspace');
    await user.click(screen.getByRole('button', { name: 'onboarding.createWorkspace' }));

    // After creation, step 2 (tool config) should be shown
    // toolsTitle appears in the header span and the card title
    await waitFor(() => {
      expect(screen.getAllByText('onboarding.toolsTitle').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('onboarding.toolsSkipLink')).toBeInTheDocument();
    expect(screen.getByText('onboarding.continueTools')).toBeInTheDocument();
    // Integrations panel title should be rendered
    expect(screen.getByText('onboarding.integrations')).toBeInTheDocument();
  });

  it('returns early when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      login: vi.fn(),
          logout: vi.fn(),
      isAuthenticated: false,
      token: null,
      user: null,
    });

    renderWithProviders(<OnboardingPage />, { initialEntries: ['/onboarding'] });

    // Component returns <Navigate to="/login"> early — no workspace form rendered
    expect(screen.queryByLabelText(/onboarding.workspaceName/)).not.toBeInTheDocument();

    // Restore default
    mockUseAuth.mockReturnValue({
      login: vi.fn(),
          logout: vi.fn(),
      isAuthenticated: true,
      token: 'test-token',
      user: { id: 1, username: 'admin', displayName: null, role: 'admin' },
    });
  });
});
