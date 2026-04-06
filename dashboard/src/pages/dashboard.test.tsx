import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { DashboardPage } from './dashboard';

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

vi.mock('@/api/hooks', () => ({
  useFindingCounts: vi.fn(() => ({
    data: { total: 10, Critical: 2, High: 3, Medium: 3, Low: 1, Info: 1, riskAccepted: 0 },
    isLoading: false,
  })),
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

  it('renders the Security Brief button', () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('dashboard.securityBrief')).toBeInTheDocument();
  });
});
