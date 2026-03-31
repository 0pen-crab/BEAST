import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { RepoPage } from './repo';

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
  usePullRequests: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
}));

describe('RepoPage', () => {
  it('renders the repository name as heading', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByRole('heading', { name: 'my-repo' })).toBeInTheDocument();
  });

  it('renders edit and delete buttons', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByRole('button', { name: 'common.edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.delete' })).toBeInTheDocument();
  });

  it('renders severity count cards', () => {
    renderWithProviders(<RepoPage />);

    // Total findings count
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders scan results by tool section', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByText('repo.scanResultsByTool')).toBeInTheDocument();
  });

  it('renders the all findings section', () => {
    renderWithProviders(<RepoPage />);

    expect(screen.getByText('repo.allFindings')).toBeInTheDocument();
  });
});
