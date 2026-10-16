import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { TeamsPage } from './teams';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/hooks', () => ({
  useTeams: vi.fn(() => ({ data: null, isLoading: false })),
  useCreateTeam: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

const { useTeams, useCreateTeam } = await import('@/api/hooks');

describe('TeamsPage', () => {
  it('renders page title', () => {
    renderWithProviders(<TeamsPage />);
    expect(screen.getByText('teams.title')).toBeInTheDocument();
  });

  it('shows empty state when no teams', () => {
    vi.mocked(useTeams).mockReturnValue({ data: [], isLoading: false } as any);
    renderWithProviders(<TeamsPage />);
    expect(screen.getByText('teams.noTeams')).toBeInTheDocument();
  });

  it('shows skeleton when loading', () => {
    vi.mocked(useTeams).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = renderWithProviders(<TeamsPage />);
    expect(container.querySelector('.beast-skeleton')).toBeInTheDocument();
  });

  it('renders team rows in table with computed fields', () => {
    vi.mocked(useTeams).mockReturnValue({
      data: [
        { id: 1, name: 'Platform', description: 'Core services', workspaceId: 1, createdAt: '2026-01-01', repoCount: 24, contributorCount: 8, findingsCount: 142, avgRiskScore: 7.2 },
        { id: 2, name: 'DevOps', description: null, workspaceId: 1, createdAt: '2026-01-01', repoCount: 15, contributorCount: 5, findingsCount: 31, avgRiskScore: 1.8 },
      ],
      isLoading: false,
    } as any);

    renderWithProviders(<TeamsPage />);

    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Core services')).toBeInTheDocument();
    expect(screen.getByText('DevOps')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('renders create team button', () => {
    renderWithProviders(<TeamsPage />);
    expect(screen.getByText('teams.createTeam')).toBeInTheDocument();
  });

  it('opens create team modal on button click', () => {
    renderWithProviders(<TeamsPage />);
    fireEvent.click(screen.getByText('teams.createTeam'));
    expect(screen.getByText('teams.teamName')).toBeInTheDocument();
  });

  it('closes modal on cancel', () => {
    renderWithProviders(<TeamsPage />);
    fireEvent.click(screen.getByText('teams.createTeam'));
    fireEvent.click(screen.getByText('common.cancel'));
    expect(screen.queryByText('teams.teamName')).not.toBeInTheDocument();
  });

  it('calls createTeam mutation on submit', () => {
    const mutateFn = vi.fn();
    vi.mocked(useCreateTeam).mockReturnValue({ mutate: mutateFn, isPending: false } as any);
    renderWithProviders(<TeamsPage />);
    fireEvent.click(screen.getByText('teams.createTeam'));
    const input = screen.getByPlaceholderText('teams.teamName');
    fireEvent.change(input, { target: { value: 'New Team' } });
    fireEvent.click(screen.getByText('common.create'));
    expect(mutateFn).toHaveBeenCalledWith(
      { name: 'New Team', description: '' },
      expect.any(Object),
    );
  });
});
