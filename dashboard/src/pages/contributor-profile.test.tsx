import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { ContributorProfilePage } from './contributor-profile';

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
    useParams: vi.fn(() => ({ id: '1' })),
  };
});

vi.mock('@/api/hooks', () => ({
  useContributor: vi.fn(() => ({ data: null, isLoading: false })),
  useContributorActivity: vi.fn(() => ({ data: [], isLoading: false })),
  useContributorRepos: vi.fn(() => ({ data: [], isLoading: false })),
  useContributorAssessments: vi.fn(() => ({ data: [], isLoading: false })),
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

const { useContributor, useContributorActivity, useContributorRepos, useContributorAssessments } = await import('@/api/hooks');

describe('ContributorProfilePage', () => {
  it('shows not-found message when contributor is null', () => {
    renderWithProviders(<ContributorProfilePage />);

    expect(screen.getByText('Contributor not found')).toBeInTheDocument();
    expect(screen.getByText('Back to Contributors')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading', () => {
    vi.mocked(useContributor).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    const { container } = renderWithProviders(<ContributorProfilePage />);

    expect(container.querySelector('.beast-skeleton')).toBeInTheDocument();
  });

  it('renders contributor profile with data', () => {
    vi.mocked(useContributor).mockReturnValue({
      data: {
        id: 1,
        displayName: 'Jane Smith',
        emails: ['jane@example.com', 'jane@corp.com'],
        firstSeen: '2025-01-15',
        lastSeen: '2026-03-01',
        totalCommits: 150,
        totalLocAdded: 5000,
        totalLocRemoved: 2000,
        repoCount: 4,
        scoreOverall: 7.8,
        scoreSecurity: 8.0,
        scoreQuality: 7.5,
        scorePatterns: 7.0,
        scoreTesting: 6.5,
        scoreInnovation: 8.0,
        createdAt: '2025-01-15',
        updatedAt: '2026-03-01',
      },
      isLoading: false,
    } as any);

    vi.mocked(useContributorActivity).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    vi.mocked(useContributorRepos).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    vi.mocked(useContributorAssessments).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    renderWithProviders(<ContributorProfilePage />);

    // Contributor name displayed (in breadcrumb + heading)
    expect(screen.getAllByText('Jane Smith').length).toBeGreaterThanOrEqual(1);
    // Emails shown (joined with middot separator)
    expect(screen.getByText('jane@example.com \u00B7 jane@corp.com')).toBeInTheDocument();
    // Stats
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Repositories')).toBeInTheDocument();
    expect(screen.getByText('Commits')).toBeInTheDocument();
    // Score sections
    expect(screen.getByText('Code Quality Assessment')).toBeInTheDocument();
    expect(screen.getByText('Contribution Activity')).toBeInTheDocument();
  });

  it('shows "Not Yet Assessed" when scores are null', () => {
    vi.mocked(useContributor).mockReturnValue({
      data: {
        id: 2,
        displayName: 'New Dev',
        emails: ['new@example.com'],
        firstSeen: null,
        lastSeen: null,
        totalCommits: 0,
        totalLocAdded: 0,
        totalLocRemoved: 0,
        repoCount: 0,
        scoreOverall: null,
        scoreSecurity: null,
        scoreQuality: null,
        scorePatterns: null,
        scoreTesting: null,
        scoreInnovation: null,
        createdAt: '2026-03-01',
        updatedAt: '2026-03-01',
      },
      isLoading: false,
    } as any);

    renderWithProviders(<ContributorProfilePage />);

    expect(screen.getByText('Not Yet Assessed')).toBeInTheDocument();
  });

  it('renders breadcrumb navigation', () => {
    vi.mocked(useContributor).mockReturnValue({
      data: {
        id: 1,
        displayName: 'Alice',
        emails: ['alice@test.com'],
        firstSeen: null,
        lastSeen: null,
        totalCommits: 10,
        totalLocAdded: 100,
        totalLocRemoved: 50,
        repoCount: 1,
        scoreOverall: null,
        scoreSecurity: null,
        scoreQuality: null,
        scorePatterns: null,
        scoreTesting: null,
        scoreInnovation: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      isLoading: false,
    } as any);

    renderWithProviders(<ContributorProfilePage />);

    expect(screen.getByText('Contributors')).toBeInTheDocument();
    // Alice appears in both breadcrumb and heading
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1);
  });

  it('shows repo breakdown section', () => {
    vi.mocked(useContributor).mockReturnValue({
      data: {
        id: 1,
        displayName: 'Bob',
        emails: ['bob@test.com'],
        firstSeen: null,
        lastSeen: null,
        totalCommits: 5,
        totalLocAdded: 200,
        totalLocRemoved: 50,
        repoCount: 0,
        scoreOverall: null,
        scoreSecurity: null,
        scoreQuality: null,
        scorePatterns: null,
        scoreTesting: null,
        scoreInnovation: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      isLoading: false,
    } as any);

    vi.mocked(useContributorRepos).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    renderWithProviders(<ContributorProfilePage />);

    expect(screen.getByText('Contributing to 0 Repositories')).toBeInTheDocument();
    expect(screen.getByText('No repository data collected yet')).toBeInTheDocument();
  });
});
