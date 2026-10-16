import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { DashboardPage } from './dashboard';

const mockApiFetch = vi.fn();
vi.mock('@/api/client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    currentWorkspace: { id: 1, name: 'Test Workspace', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' },
    workspaces: [{ id: 1, name: 'Test Workspace', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' }],
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  })),
}));

const mockUseFindingCounts = vi.fn(() => ({
  data: { total: 10, Critical: 2, High: 3, Medium: 3, Low: 1, Info: 1, riskAccepted: 0 } as
    { total: number; Critical: number; High: number; Medium: number; Low: number; Info: number; riskAccepted: number } | undefined,
  isLoading: false,
}));

vi.mock('@/api/hooks', () => ({
  useFindingCounts: () => mockUseFindingCounts(),
  useFindingCountsByTool: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useTeams: vi.fn(() => ({ data: [{ id: 1, name: 'Team A' }], isLoading: false })),
  useRepositories: vi.fn(() => ({
    data: [
      { id: 1, name: 'repo-1', tags: [], findingsCount: 5, teamId: 1 },
    ],
    isLoading: false,
  })),
}));

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ count: 0, results: [] }),
  });
  mockUseFindingCounts.mockReset();
  mockUseFindingCounts.mockReturnValue({
    data: { total: 10, Critical: 2, High: 3, Medium: 3, Low: 1, Info: 1, riskAccepted: 0 },
    isLoading: false,
  });
});

describe('DashboardPage', () => {
  it('renders the dashboard heading', () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByRole('heading', { name: 'dashboard.title' })).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('dashboard.subtitle')).toBeInTheDocument();
  });

  it('renders stats cards with finding counts', () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('dashboard.totalFindings')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders a skeleton (not nothing) while finding counts are loading', () => {
    mockUseFindingCounts.mockReturnValue({ data: undefined, isLoading: true });

    const { container } = renderWithProviders(<DashboardPage />);

    // SeverityBreakdownBar renders a CardSkeleton instead of returning null
    expect(container.querySelectorAll('.beast-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText('dashboard.severityDistribution')).not.toBeInTheDocument();
  });

  it('renders the security tools section', () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('dashboard.securityTools')).toBeInTheDocument();
  });

  it('renders the recent scans section', () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('dashboard.recentScans')).toBeInTheDocument();
  });

  it('renders the repositories section', () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('dashboard.repositories')).toBeInTheDocument();
  });

  it('renders the Export button', () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('export.button')).toBeInTheDocument();
  });

  describe('recent scans', () => {
    it('fetches scans via apiFetch and renders scan rows', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          count: 1,
          results: [
            {
              id: 'scan-1',
              status: 'completed',
              repoName: 'my-repo',
              createdAt: '2026-01-10T00:00:00Z',
              startedAt: '2026-01-10T00:00:00Z',
              completedAt: '2026-01-10T00:01:30Z',
            },
          ],
        }),
      });

      renderWithProviders(<DashboardPage />);

      expect(await screen.findByText('my-repo')).toBeInTheDocument();
      expect(mockApiFetch).toHaveBeenCalledWith('/api/scans?limit=10&workspace_id=1');
    });

    it('deep-links each scan row to the specific scan on the scans page', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          count: 1,
          results: [
            {
              id: 'scan-1',
              status: 'completed',
              repoName: 'my-repo',
              createdAt: '2026-01-10T00:00:00Z',
              startedAt: '2026-01-10T00:00:00Z',
              completedAt: '2026-01-10T00:01:30Z',
            },
          ],
        }),
      });

      renderWithProviders(<DashboardPage />);

      const link = await screen.findByRole('link', { name: 'my-repo' });
      expect(link).toHaveAttribute('href', '/scans?scan=scan-1');
    });

    it('shows the amber completed-with-errors badge instead of the green completed pill', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          count: 2,
          results: [
            {
              id: 'scan-1',
              status: 'completed',
              completedWithErrors: true,
              repoName: 'partial-repo',
              createdAt: '2026-01-10T00:00:00Z',
              startedAt: '2026-01-10T00:00:00Z',
              completedAt: '2026-01-10T00:01:30Z',
            },
            {
              id: 'scan-2',
              status: 'completed',
              completedWithErrors: false,
              repoName: 'clean-repo',
              createdAt: '2026-01-10T00:00:00Z',
              startedAt: '2026-01-10T00:00:00Z',
              completedAt: '2026-01-10T00:01:30Z',
            },
          ],
        }),
      });

      renderWithProviders(<DashboardPage />);

      // Partial scan: amber pill (same treatment as the Scans page) + tooltip
      const amber = await screen.findByText('scans.completedWithErrors');
      expect(amber).toHaveClass('status-paused');
      expect(amber).not.toHaveClass('status-completed');
      expect(amber).toHaveAttribute('title', 'scans.completedWithErrorsTooltip');

      // Clean scan keeps the green completed pill
      const green = screen.getByText('status.completed');
      expect(green).toHaveClass('status-completed');
    });

    it('shows empty state when API returns no scans', async () => {
      renderWithProviders(<DashboardPage />);

      expect(await screen.findByText('dashboard.noScansYet')).toBeInTheDocument();
    });

    it('shows an error state (not the empty state) when the API fails', async () => {
      mockApiFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      renderWithProviders(<DashboardPage />);

      expect(await screen.findByText('dashboard.scansError')).toBeInTheDocument();
      expect(screen.queryByText('dashboard.noScansYet')).not.toBeInTheDocument();
    });

    it('retries the request when Retry is clicked', async () => {
      const user = userEvent.setup();
      mockApiFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      renderWithProviders(<DashboardPage />);

      const retryBtn = await screen.findByRole('button', { name: 'common.retry' });
      mockApiFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          count: 1,
          results: [
            {
              id: 'scan-2',
              status: 'completed',
              repoName: 'retried-repo',
              createdAt: '2026-01-10T00:00:00Z',
              startedAt: null,
              completedAt: null,
            },
          ],
        }),
      });
      await user.click(retryBtn);

      expect(await screen.findByText('retried-repo')).toBeInTheDocument();
    });
  });
});
