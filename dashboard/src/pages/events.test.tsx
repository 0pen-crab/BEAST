import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { EventsPage } from './events';

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
  useScanEvents: vi.fn(() => ({
    data: { count: 0, results: [] },
    isLoading: false,
  })),
  useScanEventStats: vi.fn(() => ({
    data: { total: 5, unresolved: 2, unresolvedErrors: 1, unresolvedWarnings: 1 },
    isLoading: false,
  })),
  useResolveScanEvent: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useUnresolveScanEvent: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useWorkspaceEvents: vi.fn(() => ({
    data: { count: 0, results: [] },
    isLoading: false,
  })),
}));

describe('EventsPage', () => {
  it('renders the events page heading', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByRole('heading', { name: 'events.title' })).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByText('events.subtitle')).toBeInTheDocument();
  });

  it('renders scan and workspace event tabs', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByRole('button', { name: 'events.scanEvents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'events.workspaceEvents' })).toBeInTheDocument();
  });

  it('renders stat cards', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByText('events.unresolvedErrors')).toBeInTheDocument();
    expect(screen.getByText('events.unresolvedWarnings')).toBeInTheDocument();
    expect(screen.getByText('events.totalUnresolved')).toBeInTheDocument();
    expect(screen.getByText('events.totalEvents')).toBeInTheDocument();
  });

  it('renders level filter buttons', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByRole('button', { name: 'all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'warning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'info' })).toBeInTheDocument();
  });

  it('renders the show resolved checkbox', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByLabelText('events.showResolved')).toBeInTheDocument();
  });

  it('renders empty state when no events', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByText('events.allClear')).toBeInTheDocument();
  });
});
