import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { TeamDetailPage } from './team-detail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: vi.fn(() => ({ id: '1' })) };
});

vi.mock('@/api/hooks', () => ({
  useTeam: vi.fn(() => ({ data: null, isLoading: false })),
  useRepositories: vi.fn(() => ({ data: null, isLoading: false })),
  useTeamContributors: vi.fn(() => ({ data: null, isLoading: false })),
  useFindingCounts: vi.fn(() => ({ data: null, isLoading: false })),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    currentWorkspace: { id: 1, name: 'Test', description: '', defaultLanguage: 'en', createdAt: '2026-01-01' },
    workspaces: [{ id: 1, name: 'Test' }],
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  })),
}));

const { useTeam, useRepositories, useTeamContributors } = await import('@/api/hooks');

describe('TeamDetailPage', () => {
  it('renders breadcrumb', () => {
    renderWithProviders(<TeamDetailPage />);
    expect(screen.getByText('nav.teams')).toBeInTheDocument();
  });

  it('shows team name and description', () => {
    vi.mocked(useTeam).mockReturnValue({
      data: { id: 1, name: 'Platform', description: 'Core services', workspaceId: 1, createdAt: '2026-01-01', repoCount: 24, contributorCount: 8, findingsCount: 142, avgRiskScore: 7.2 },
      isLoading: false,
    } as any);
    vi.mocked(useRepositories).mockReturnValue({ data: [], isLoading: false } as any);
    vi.mocked(useTeamContributors).mockReturnValue({ data: [], isLoading: false } as any);

    renderWithProviders(<TeamDetailPage />);
    expect(screen.getAllByText('Platform').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Core services')).toBeInTheDocument();
  });

  it('renders stat metrics', () => {
    vi.mocked(useTeam).mockReturnValue({
      data: { id: 1, name: 'Platform', description: null, workspaceId: 1, createdAt: '2026-01-01', repoCount: 24, contributorCount: 8, findingsCount: 142, avgRiskScore: 7.2 },
      isLoading: false,
    } as any);
    vi.mocked(useRepositories).mockReturnValue({ data: [], isLoading: false } as any);
    vi.mocked(useTeamContributors).mockReturnValue({ data: [], isLoading: false } as any);

    renderWithProviders(<TeamDetailPage />);
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('renders contributors in the panel', () => {
    vi.mocked(useTeam).mockReturnValue({
      data: { id: 1, name: 'Team', description: null, workspaceId: 1, createdAt: '2026-01-01' },
      isLoading: false,
    } as any);
    vi.mocked(useRepositories).mockReturnValue({ data: [], isLoading: false } as any);
    vi.mocked(useTeamContributors).mockReturnValue({
      data: [{ id: 1, display_name: 'Dmytro K', total_commits: 100, total_loc_added: 5000, total_loc_removed: 1000, score_overall: 8.4 }],
      isLoading: false,
    } as any);

    renderWithProviders(<TeamDetailPage />);
    expect(screen.getByText('Dmytro K')).toBeInTheDocument();
  });

  it('shows empty state when no repos', () => {
    vi.mocked(useTeam).mockReturnValue({
      data: { id: 1, name: 'Team', description: null, workspaceId: 1, createdAt: '2026-01-01' },
      isLoading: false,
    } as any);
    vi.mocked(useRepositories).mockReturnValue({ data: [], isLoading: false } as any);
    vi.mocked(useTeamContributors).mockReturnValue({ data: [], isLoading: false } as any);

    renderWithProviders(<TeamDetailPage />);
    expect(screen.getByText('teams.noRepos')).toBeInTheDocument();
  });
});
