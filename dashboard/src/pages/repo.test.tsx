import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { RepoPage } from './repo';
import { useRepository, useRepositoryTests, useFindingCountsByTool, useDeleteRepository, useRepoReports, useLatestRepoScan } from '@/api/hooks';
import { useNavigate } from 'react-router';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useParams: vi.fn(() => ({ id: '1' })),
    useNavigate: vi.fn(() => vi.fn()),
  };
});

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    currentWorkspace: { id: 1, name: 'Test', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' },
    workspaces: [{ id: 1, name: 'Test' }],
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  })),
}));

vi.mock('@/api/hooks', () => ({
  useRepository: vi.fn(() => ({
    data: { id: 1, name: 'my-repo', description: 'A test repo', tags: ['js'], teamId: 1, status: 'completed' },
    isLoading: false,
  })),
  useRepositoryTests: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useFindingCounts: vi.fn(() => ({
    data: { total: 5, Critical: 1, High: 2, Medium: 1, Low: 1, Info: 0, riskAccepted: 0 },
    isLoading: false,
  })),
  useFindings: vi.fn(() => ({
    data: { count: 0, results: [] },
    isLoading: false,
  })),
  useTest: vi.fn(() => ({ data: null })),
  useUpdateRepository: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useDeleteRepository: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useTeams: vi.fn(() => ({
    data: [{ id: 1, name: 'Team A' }],
    isLoading: false,
  })),
  useRepoReports: vi.fn(() => ({
    data: null,
    isLoading: false,
  })),
  useScanArtifacts: vi.fn(() => ({
    data: null,
    isLoading: false,
  })),
  useTriggerScan: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useSource: vi.fn(() => ({
    data: null,
    isLoading: false,
  })),
  useFindingCountsByTool: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useAiTraces: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
  useLatestRepoScan: vi.fn(() => ({
    data: null,
    isLoading: false,
  })),
}));

beforeEach(() => {
  vi.mocked(useNavigate).mockReturnValue(vi.fn());
  vi.mocked(useDeleteRepository).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as any);
  vi.mocked(useRepoReports).mockReturnValue({
    data: null,
    isLoading: false,
  } as any);
});

describe('RepoPage', () => {
  it('renders the repository name as heading', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByRole('heading', { name: 'my-repo' })).toBeInTheDocument();
  });

  it('renders scan and delete buttons', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByRole('button', { name: 'repos.scan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.delete' })).toBeInTheDocument();
  });

  it('renders severity count cards with translated labels', () => {
    renderWithProviders(<RepoPage />);

    // Labels go through t('severity.'+sev) — the t() mock returns the key
    expect(screen.getByText('severity.Critical')).toBeInTheDocument();
    expect(screen.getByText('severity.High')).toBeInTheDocument();
    expect(screen.getByText('severity.Medium')).toBeInTheDocument();
  });

  it('renders scan results by tool section', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByText('repo.scanResultsByTool')).toBeInTheDocument();
  });

  it('shows the OPEN finding count per tool (not the static test count) and deep-links with status=open', () => {
    vi.mocked(useRepositoryTests).mockReturnValueOnce({
      data: [{ id: 1, tool: 'osv-scanner', scanType: 'SARIF', testTitle: '', fileName: '', findingsCount: 139, createdAt: '2026-05-27T00:00:00Z' }],
      isLoading: false,
    } as any);
    vi.mocked(useFindingCountsByTool).mockReturnValueOnce({
      data: [{ tool: 'osv-scanner', active: 45, dismissed: 94 }],
      isLoading: false,
    } as any);

    renderWithProviders(<RepoPage />);

    // The live OPEN count (45) is shown — not the static deduplicated total (139)
    expect(screen.getAllByText('45').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('139')).not.toBeInTheDocument();

    // Clicking the tool deep-links to findings filtered by tool + repo + open status
    const link = screen.getByRole('link', { name: /OSV-Scanner/i });
    expect(link).toHaveAttribute('href', '/findings?tool=osv-scanner&repository=1&status=open');
  });

  it('renders the all findings section', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByText('repo.topFindings')).toBeInTheDocument();
  });
});

describe('scan trigger button', () => {
  it('is disabled while the repo is queued', () => {
    vi.mocked(useRepository).mockReturnValueOnce({
      data: { id: 1, name: 'my-repo', description: null, tags: [], teamId: 1, status: 'queued' },
      isLoading: false,
    } as any);
    renderWithProviders(<RepoPage />);

    expect(screen.getByRole('button', { name: 'repos.scan' })).toBeDisabled();
  });

  it('is disabled while the repo is analyzing', () => {
    vi.mocked(useRepository).mockReturnValueOnce({
      data: { id: 1, name: 'my-repo', description: null, tags: [], teamId: 1, status: 'analyzing' },
      isLoading: false,
    } as any);
    renderWithProviders(<RepoPage />);

    expect(screen.getByRole('button', { name: 'repos.scan' })).toBeDisabled();
  });

  it('is enabled when the repo is completed', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByRole('button', { name: 'repos.scan' })).toBeEnabled();
  });
});

describe('delete flow', () => {
  it('navigates to /repos after a successful delete', async () => {
    const navSpy = vi.fn();
    vi.mocked(useNavigate).mockReturnValue(navSpy);
    vi.mocked(useDeleteRepository).mockReturnValue({
      mutate: vi.fn((_id: number, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
      isPending: false,
    } as any);
    const user = userEvent.setup();
    renderWithProviders(<RepoPage />);

    await user.click(screen.getByRole('button', { name: 'common.delete' }));
    // Modal confirm button is the second common.delete button
    const deleteButtons = screen.getAllByRole('button', { name: 'common.delete' });
    await user.click(deleteButtons[deleteButtons.length - 1]);

    expect(navSpy).toHaveBeenCalledWith('/repos');
  });

  it('closes the delete confirmation on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RepoPage />);

    await user.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(screen.getByText('repo.deleteRepo')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('repo.deleteRepo')).not.toBeInTheDocument();
  });
});

describe('tab in URL', () => {
  it('defaults to the Overview tab', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByText('repo.scanResultsByTool')).toBeInTheDocument();
  });

  it('restores the AI Trace tab from ?tab=ai-trace', () => {
    renderWithProviders(<RepoPage />, { initialEntries: ['/repos/1?tab=ai-trace'] });

    // Overview content is not shown; the AI Trace tab is active
    expect(screen.queryByText('repo.scanResultsByTool')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'repo.aiTraceTab' }).className).toContain('beast-tab-active');
  });

  it('switches tabs on click and back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RepoPage />);

    await user.click(screen.getByRole('button', { name: 'repo.aiTraceTab' }));
    expect(screen.queryByText('repo.scanResultsByTool')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'repo.overview' }));
    expect(screen.getByText('repo.scanResultsByTool')).toBeInTheDocument();
  });
});

describe('report cards', () => {
  const reports = {
    profile: { content: 'profile words here', updated_at: '2026-05-01T00:00:00Z' },
    audit: null,
  };

  it('are keyboard accessible and open the reader on Enter', async () => {
    vi.mocked(useRepoReports).mockReturnValue({ data: reports, isLoading: false } as any);
    renderWithProviders(<RepoPage />);

    const card = screen.getByRole('button', { name: /repo\.repoProfile/ });
    expect(card).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(card, { key: 'Enter' });

    // ReportReader opens (portal) with the download action
    expect(await screen.findByText('repo.downloadMd')).toBeInTheDocument();
  });

  it('unavailable cards are not focusable', () => {
    vi.mocked(useRepoReports).mockReturnValue({ data: reports, isLoading: false } as any);
    renderWithProviders(<RepoPage />);

    const disabledCard = screen.getByRole('button', { name: /repo\.securityAudit/ });
    expect(disabledCard).toHaveAttribute('tabindex', '-1');
    expect(disabledCard).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('completed-with-errors notice', () => {
  it('shows the notice with a link to the scan when the latest scan completed with errors', () => {
    vi.mocked(useLatestRepoScan).mockReturnValue({
      data: { id: 'scan-9', status: 'completed', completedWithErrors: true, stepErrors: [] },
      isLoading: false,
    } as any);

    renderWithProviders(<RepoPage />);

    const notice = screen.getByTestId('repo-scan-errors-notice');
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toContain('repo.lastScanCompletedWithErrors');
    const link = screen.getByRole('link', { name: 'repo.openScan' });
    expect(link).toHaveAttribute('href', '/scans?scan=scan-9');
  });

  it('does NOT show the notice when the latest scan completed cleanly', () => {
    vi.mocked(useLatestRepoScan).mockReturnValue({
      data: { id: 'scan-9', status: 'completed', completedWithErrors: false, stepErrors: [] },
      isLoading: false,
    } as any);

    renderWithProviders(<RepoPage />);
    expect(screen.queryByTestId('repo-scan-errors-notice')).not.toBeInTheDocument();
  });

  it('does NOT show the notice for a failed latest scan (that is the repo status badge job)', () => {
    vi.mocked(useLatestRepoScan).mockReturnValue({
      data: { id: 'scan-9', status: 'failed', completedWithErrors: false, stepErrors: [] },
      isLoading: false,
    } as any);

    renderWithProviders(<RepoPage />);
    expect(screen.queryByTestId('repo-scan-errors-notice')).not.toBeInTheDocument();
  });
});
