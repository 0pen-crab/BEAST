import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
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
  useMergeContributors: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
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

const { useContributors, useTeams, useMergeContributors } = await import('@/api/hooks');

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

describe('ContributorsPage duplicate suggestions', () => {
  const duplicatePair = () => [
    mockContributor({
      id: 1,
      displayName: 'David Malko',
      emails: ['david.malko@corp.com'],
      totalCommits: 100,
      lastSeen: '2026-05-01',
    }),
    mockContributor({
      id: 2,
      displayName: 'David Malko',
      emails: ['dmalko@old-corp.io'],
      totalCommits: 10,
      lastSeen: '2026-06-01',
    }),
  ];

  beforeEach(() => {
    vi.mocked(useTeams).mockReturnValue({ data: [] } as any);
  });

  it('does not render the banner when there are no duplicate candidates', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 1, results: [mockContributor()] },
      isLoading: false,
    } as any);
    renderWithProviders(<ContributorsPage />);
    expect(screen.queryByTestId('duplicate-suggestions')).not.toBeInTheDocument();
  });

  it('renders a collapsed banner when duplicate candidates exist', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 2, results: duplicatePair() },
      isLoading: false,
    } as any);
    renderWithProviders(<ContributorsPage />);
    const banner = screen.getByTestId('duplicate-suggestions');
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByText(/contributors.duplicatesBanner/)).toBeInTheDocument();
    // Collapsed by default — no groups listed yet
    expect(screen.queryByTestId('duplicate-group')).not.toBeInTheDocument();
  });

  it('expands to list group members with names and emails side by side', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 2, results: duplicatePair() },
      isLoading: false,
    } as any);
    renderWithProviders(<ContributorsPage />);

    fireEvent.click(screen.getByText(/contributors.duplicatesBanner/));

    const group = screen.getByTestId('duplicate-group');
    expect(within(group).getAllByText('David Malko')).toHaveLength(2);
    expect(within(group).getByText('david.malko@corp.com')).toBeInTheDocument();
    expect(within(group).getByText('dmalko@old-corp.io')).toBeInTheDocument();
    // reason tag
    expect(within(group).getByText('contributors.duplicateReasonSameName')).toBeInTheDocument();
  });

  it('opens the merge modal prefilled with the pair, target = most commits', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 2, results: duplicatePair() },
      isLoading: false,
    } as any);
    const { container } = renderWithProviders(<ContributorsPage />);

    fireEvent.click(screen.getByText(/contributors.duplicatesBanner/));
    const group = screen.getByTestId('duplicate-group');
    fireEvent.click(within(group).getByText('contributors.merge'));

    // Existing bulk merge modal opens, prefilled with exactly the two members
    expect(screen.getByText('contributors.mergeBulkTitle')).toBeInTheDocument();
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="merge-target"]');
    expect(radios).toHaveLength(2);
    // Target defaults to the contributor with MORE commits (id 1, 100 commits),
    // even though id 2 was seen more recently.
    const checked = Array.from(radios).find((r) => r.checked);
    expect(checked?.value).toBe('1');
  });

  it('does not call the merge API just by opening the modal', () => {
    const mutateAsync = vi.fn();
    vi.mocked(useMergeContributors).mockReturnValue({
      mutateAsync, isPending: false, error: null,
    } as any);
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 2, results: duplicatePair() },
      isLoading: false,
    } as any);
    renderWithProviders(<ContributorsPage />);

    fireEvent.click(screen.getByText(/contributors.duplicatesBanner/));
    fireEvent.click(within(screen.getByTestId('duplicate-group')).getByText('contributors.merge'));

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('dismissing a group hides it for the session', () => {
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 2, results: duplicatePair() },
      isLoading: false,
    } as any);
    renderWithProviders(<ContributorsPage />);

    fireEvent.click(screen.getByText(/contributors.duplicatesBanner/));
    const group = screen.getByTestId('duplicate-group');
    fireEvent.click(within(group).getByLabelText('contributors.dismissSuggestion'));

    expect(screen.queryByTestId('duplicate-group')).not.toBeInTheDocument();
    // Last group dismissed → whole banner disappears
    expect(screen.queryByTestId('duplicate-suggestions')).not.toBeInTheDocument();
  });

  it('keeps the banner when only one of several groups is dismissed', () => {
    const results = [
      ...duplicatePair(),
      mockContributor({ id: 3, displayName: 'Anna Koval', emails: ['anna.koval@x.com'], totalCommits: 5 }),
      mockContributor({ id: 4, displayName: 'A. Koval', emails: ['anna.koval@y.com'], totalCommits: 7 }),
    ];
    vi.mocked(useContributors).mockReturnValue({
      data: { count: 4, results },
      isLoading: false,
    } as any);
    renderWithProviders(<ContributorsPage />);

    fireEvent.click(screen.getByText(/contributors.duplicatesBanner/));
    const groups = screen.getAllByTestId('duplicate-group');
    expect(groups).toHaveLength(2);

    fireEvent.click(within(groups[0]).getByLabelText('contributors.dismissSuggestion'));

    expect(screen.getAllByTestId('duplicate-group')).toHaveLength(1);
    expect(screen.getByTestId('duplicate-suggestions')).toBeInTheDocument();
  });
});
