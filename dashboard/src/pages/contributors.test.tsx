import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { ContributorsPage } from './contributors';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/hooks', () => ({
  useContributors: vi.fn(() => ({ data: null, isLoading: false })),
  useTeams: vi.fn(() => ({ data: [] })),
  useBulkUpdateContributors: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

const { useContributors, useTeams, useBulkUpdateContributors } = await import('@/api/hooks');

const mockContributor = (overrides = {}) => ({
  id: 1,
  teamId: null,
  displayName: 'John Doe',
  emails: ['john@example.com'],
  firstSeen: '2025-01-01',
  lastSeen: '2026-03-01',
  totalCommits: 42,
  totalLocAdded: 1500,
  totalLocRemoved: 300,
  repoCount: 3,
  scoreOverall: 8.5,
  scoreSecurity: 9.0,
  scoreQuality: 7.5,
  scorePatterns: null,
  scoreTesting: null,
  scoreInnovation: null,
  feedback: null,
  createdAt: '2025-01-01',
  updatedAt: '2026-03-01',
  ...overrides,
});

describe('ContributorsPage', () => {
  it('renders page title', () => {
    renderWithProviders(<ContributorsPage />);
    expect(screen.getByText('contributors.title')).toBeInTheDocument();
  });

  it('shows empty state when no contributors', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 0, results: [] },
      isLoading: false,
    } as any);
    renderWithProviders(<ContributorsPage />);
    expect(screen.getByText('contributors.noContributors')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading', () => {
    vi.mocked(useContributors).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = renderWithProviders(<ContributorsPage />);
    expect(container.querySelector('.beast-skeleton')).toBeInTheDocument();
  });

  it('renders contributor rows with scores and stats', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: {
        count: 1,
        results: [mockContributor()],
      },
      isLoading: false,
    } as any);

    renderWithProviders(<ContributorsPage />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('8.5')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows search input', () => {
    renderWithProviders(<ContributorsPage />);
    expect(screen.getByPlaceholderText('contributors.searchPlaceholder')).toBeInTheDocument();
  });

  it('renders sortable column headers', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 1, results: [mockContributor()] },
      isLoading: false,
    } as any);
    renderWithProviders(<ContributorsPage />);

    expect(screen.getByText('contributors.contributor')).toBeInTheDocument();
    expect(screen.getByText('contributors.overall')).toBeInTheDocument();
    expect(screen.getByText('contributors.security')).toBeInTheDocument();
    expect(screen.getByText('contributors.quality')).toBeInTheDocument();
    expect(screen.getByText('contributors.commits')).toBeInTheDocument();
  });

  it('renders checkboxes for selection', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 1, results: [mockContributor()] },
      isLoading: false,
    } as any);
    const { container } = renderWithProviders(<ContributorsPage />);
    const checkboxes = container.querySelectorAll('.beast-checkbox');
    // header checkbox + 1 row checkbox
    expect(checkboxes.length).toBe(2);
  });

  it('shows bulk bar when items selected', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 1, results: [mockContributor()] },
      isLoading: false,
    } as any);
    const { container } = renderWithProviders(<ContributorsPage />);

    // Click row checkbox
    const rowCheckbox = container.querySelectorAll('.beast-checkbox')[1];
    fireEvent.click(rowCheckbox);

    expect(screen.getByText('contributors.assignToTeam')).toBeInTheDocument();
    expect(screen.getByText(/1 common.selected/)).toBeInTheDocument();
  });

  it('shows team column with team name', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 1, results: [mockContributor({ teamId: 5 })] },
      isLoading: false,
    } as any);
    vi.mocked(useTeams).mockReturnValue({ data: [{ id: 5, name: 'Platform' }] } as any);
    renderWithProviders(<ContributorsPage />);
    // "Platform" appears in both filter dropdown and table cell
    const matches = screen.getAllByText('Platform');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('shows team filter dropdown when teams exist', () => {
    vi.mocked(useTeams).mockReturnValue({
      data: [{ id: 1, name: 'TeamA' }, { id: 2, name: 'TeamB' }],
    } as any);
    renderWithProviders(<ContributorsPage />);
    expect(screen.getByText('repos.allTeams')).toBeInTheDocument();
  });
});
