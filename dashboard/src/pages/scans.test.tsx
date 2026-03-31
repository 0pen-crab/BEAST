import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { ScansPage } from './scans';

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, username: 'admin', displayName: 'Admin User', role: 'admin' },
    logout: vi.fn(),
    token: 'test-token',
    login: vi.fn(),
  })),
}));

vi.mock('@/lib/permissions', () => ({
  useCurrentWorkspaceRole: vi.fn(() => 'workspace_admin'),
  canWrite: vi.fn(() => true),
  isSuperAdmin: vi.fn((role: string) => role === 'super_admin'),
  canManageMembers: vi.fn(() => true),
  canManageWorkspace: vi.fn(() => true),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

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
  useScans: vi.fn(() => ({
    data: { count: 0, results: [] },
    isLoading: false,
  })),
  useScanStats: vi.fn(() => ({
    data: { total: 10, queued: 2, running: 1, completed: 6, failed: 1, avg_duration_sec: 120 },
  })),
  useScanDetail: vi.fn(() => ({
    data: null,
  })),
  useCancelScan: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useRemoveScan: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

describe('ScansPage', () => {
  it('renders the scans page heading', () => {
    renderWithProviders(<ScansPage />);

    expect(screen.getByRole('heading', { name: 'scans.title' })).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    renderWithProviders(<ScansPage />);

    expect(screen.getByText('scans.subtitle')).toBeInTheDocument();
  });

  it('renders the tab buttons for queue, completed, and failed', () => {
    renderWithProviders(<ScansPage />);

    expect(screen.getByRole('button', { name: 'scans.queue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scans.completed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scans.failed' })).toBeInTheDocument();
  });

  it('renders stat cards when stats data is available', () => {
    renderWithProviders(<ScansPage />);

    expect(screen.getByText('scans.totalScans')).toBeInTheDocument();
    expect(screen.getByText('scans.running')).toBeInTheDocument();
    expect(screen.getByText('scans.inQueue')).toBeInTheDocument();
    expect(screen.getByText('scans.avgDuration')).toBeInTheDocument();
    // 'scans.completed' and 'scans.failed' appear both as stat labels and tab buttons
    expect(screen.getAllByText('scans.completed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('scans.failed').length).toBeGreaterThanOrEqual(2);
  });

  it('renders stat values from useScanStats', () => {
    renderWithProviders(<ScansPage />);

    // Check values inside stat cards (they have beast-stat-value class)
    const statValues = document.querySelectorAll('.beast-stat-value');
    const values = Array.from(statValues).map(el => el.textContent);
    expect(values).toContain('10'); // total
    expect(values).toContain('1');  // running
    expect(values).toContain('2');  // queued
    expect(values).toContain('6');  // completed
  });

  it('shows empty state message when no scans in active tab', () => {
    renderWithProviders(<ScansPage />);

    // Active tab (queued) is shown by default, and mock returns empty results
    expect(screen.getByText('scans.noScansInQueue')).toBeInTheDocument();
  });
});
