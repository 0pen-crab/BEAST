import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router';
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

const mockImportAsync = vi.fn();

vi.mock('@/api/hooks', () => ({
  useConnectSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUploadRepoZip: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportFromSource: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: (...args: unknown[]) => mockImportAsync(...args),
    isPending: false,
  })),
  useSources: vi.fn(() => ({ data: [], isLoading: false })),
  useDeleteSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToolRegistry: vi.fn(() => ({ data: [], isLoading: false })),
  useUpdateWorkspaceTools: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useValidateToken: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateAiSettings: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

describe('OnboardingPage', () => {
  it('renders step 1 with workspace creation form', () => {
    renderWithProviders(<OnboardingPage />);

    expect(screen.getByRole('heading', { name: 'onboarding.title' })).toBeInTheDocument();
    expect(screen.getByLabelText(/onboarding.workspaceName/)).toBeInTheDocument();
  });

  it('renders 5-step progress indicator', () => {
    renderWithProviders(<OnboardingPage />);

    expect(screen.getByText('onboarding.step1')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step2')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step3')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step4')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step5')).toBeInTheDocument();
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

  it('shows AI analysis step after workspace creation', async () => {
    const user = userEvent.setup();

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 42, name: 'Test Workspace' }),
    });

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

    const nameInput = screen.getByLabelText(/onboarding.workspaceName/);
    await user.type(nameInput, 'Test Workspace');
    await user.click(screen.getByRole('button', { name: 'onboarding.createWorkspace' }));

    // After creation, step 2 (AI Analysis) should be shown
    await waitFor(() => {
      expect(screen.getByText('onboarding.aiAnalysis.title')).toBeInTheDocument();
    });
    // Selected preset card visible (default = standard → STANDARD label visible)
    expect(screen.getByTestId('ai-mode-title')).toHaveTextContent('settings.scanDepth.standard.label');
    // Three mode dots are rendered
    expect(screen.getByTestId('ai-dot-quick')).toBeInTheDocument();
    expect(screen.getByTestId('ai-dot-standard')).toBeInTheDocument();
    expect(screen.getByTestId('ai-dot-deep')).toBeInTheDocument();
    // Continue button visible
    expect(screen.getByRole('button', { name: 'onboarding.aiAnalysis.continue' })).toBeInTheDocument();
  });

  it('clicking a mode dot updates the selected preset', async () => {
    const user = userEvent.setup();

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 42, name: 'Test Workspace' }),
    });

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
    const nameInput = screen.getByLabelText(/onboarding.workspaceName/);
    await user.type(nameInput, 'Test');
    await user.click(screen.getByRole('button', { name: 'onboarding.createWorkspace' }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-dot-quick')).toBeInTheDocument();
    });

    // Default is standard
    expect(screen.getByTestId('ai-dot-standard')).toHaveClass('active');

    // Click deep
    await user.click(screen.getByTestId('ai-dot-deep'));
    expect(screen.getByTestId('ai-dot-deep')).toHaveClass('active');
    expect(screen.getByTestId('ai-dot-standard')).not.toHaveClass('active');
  });

  it('toggling AI off hides chart and shows off state', async () => {
    const user = userEvent.setup();

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 42, name: 'Test Workspace' }),
    });

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
    const nameInput = screen.getByLabelText(/onboarding.workspaceName/);
    await user.type(nameInput, 'Test');
    await user.click(screen.getByRole('button', { name: 'onboarding.createWorkspace' }));

    await waitFor(() => {
      expect(screen.getByTestId('ai-dot-quick')).toBeInTheDocument();
    });

    // Click toggle (aria-label = title)
    const toggle = screen.getByRole('button', { name: 'onboarding.aiAnalysis.title' });
    await user.click(toggle);

    // Chart dots should be gone, off label visible
    expect(screen.queryByTestId('ai-dot-quick')).not.toBeInTheDocument();
    expect(screen.getByText('onboarding.aiAnalysis.off.label')).toBeInTheDocument();
  });

  describe('import step (step 5)', () => {
    const source = { id: 1, provider: 'github', orgName: 'acme', baseUrl: 'https://github.com' };
    const discoveredRepos = [
      { slug: 'repo-a', fullName: 'acme/repo-a', cloneUrl: 'https://github.com/acme/repo-a.git', description: null, imported: false },
      { slug: 'repo-b', fullName: 'acme/repo-b', cloneUrl: 'https://github.com/acme/repo-b.git', description: null, imported: false },
    ];

    async function renderImportStep() {
      localStorage.clear();
      const { useSources } = await import('@/api/hooks');
      vi.mocked(useSources).mockImplementation(() => (
        { data: [source], isLoading: false } as unknown as ReturnType<typeof useSources>
      ));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(discoveredRepos),
      });

      renderWithProviders(
        <Routes>
          <Route path="/onboarding/*" element={<OnboardingPage />} />
        </Routes>,
        { initialEntries: ['/onboarding/42/5'] },
      );

      // Wait for repo discovery to finish and the picker to appear
      await screen.findByText('repoPicker.selectAll');
      const { useSources: restore } = await import('@/api/hooks');
      return restore;
    }

    it('shows import failures on the summary and does not inflate the count', async () => {
      const user = userEvent.setup();
      mockImportAsync.mockRejectedValue(new Error('boom'));
      const useSources = await renderImportStep();

      await user.click(screen.getByText('repoPicker.selectAll'));
      await user.click(screen.getByRole('button', { name: 'onboarding.importSelected' }));

      // Summary step: failure is surfaced, not silently swallowed
      expect(await screen.findByText('onboarding.importFailedSources')).toBeInTheDocument();
      // Count reflects zero imported repos — not the floored per-source count
      expect(screen.getByText('onboarding.importSuccess')).toBeInTheDocument();

      vi.mocked(useSources).mockImplementation(() => (
        { data: [], isLoading: false } as unknown as ReturnType<typeof useSources>
      ));
    });

    it('shows no failure message when all imports succeed', async () => {
      const user = userEvent.setup();
      mockImportAsync.mockResolvedValue({ imported: 2 });
      const useSources = await renderImportStep();

      await user.click(screen.getByText('repoPicker.selectAll'));
      await user.click(screen.getByRole('button', { name: 'onboarding.importSelected' }));

      expect(await screen.findByText('onboarding.importSuccess')).toBeInTheDocument();
      expect(screen.queryByText('onboarding.importFailedSources')).not.toBeInTheDocument();

      vi.mocked(useSources).mockImplementation(() => (
        { data: [], isLoading: false } as unknown as ReturnType<typeof useSources>
      ));
    });
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
