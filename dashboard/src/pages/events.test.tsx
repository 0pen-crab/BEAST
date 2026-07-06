import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const mockUseScanEvents = vi.fn();

vi.mock('@/api/hooks', () => ({
  useScanEvents: (...args: unknown[]) => mockUseScanEvents(...args),
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

function makeEvent(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    level: 'error',
    message: `Event ${id}`,
    source: 'scanner',
    repoName: null,
    repositoryId: null,
    scanId: null,
    stepName: null,
    workspaceId: 1,
    details: {},
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: '2026-01-10T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockUseScanEvents.mockReset();
  mockUseScanEvents.mockReturnValue({
    data: { count: 0, results: [] },
    isLoading: false,
  });
});

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

  it('renders translated level filter buttons', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByRole('button', { name: 'events.levels.all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'events.levels.error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'events.levels.warning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'events.levels.info' })).toBeInTheDocument();
  });

  it('renders the show resolved checkbox', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByLabelText('events.showResolved')).toBeInTheDocument();
  });

  it('renders empty state when no events', () => {
    renderWithProviders(<EventsPage />);
    expect(screen.getByText('events.allClear')).toBeInTheDocument();
  });

  it('clamps the page when the event count shrinks below the current page', async () => {
    const user = userEvent.setup();
    // 26 unresolved events → 2 pages
    mockUseScanEvents.mockReturnValue({
      data: { count: 26, results: [makeEvent(26)] },
      isLoading: false,
    });

    const { rerender } = renderWithProviders(<EventsPage />);
    await user.click(screen.getByRole('button', { name: 'common.next' }));

    // Now on page 2 (offset 25)
    let lastCall = mockUseScanEvents.mock.calls[mockUseScanEvents.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ offset: 25 });

    // Resolving the last event on the final page shrinks the count to 25 → 1 page
    mockUseScanEvents.mockReturnValue({
      data: { count: 25, results: [] },
      isLoading: false,
    });
    rerender(<EventsPage />);

    // Page is clamped back into range and events are re-requested from page 1
    await waitFor(() => {
      lastCall = mockUseScanEvents.mock.calls[mockUseScanEvents.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ offset: 0 });
    });
    // The misleading "All clear!" empty state is not shown for an out-of-range page
  });

  it('links the repo name to the specific repo page when repositoryId is present', () => {
    mockUseScanEvents.mockReturnValue({
      data: { count: 1, results: [makeEvent(1, { repoName: 'my-repo', repositoryId: 42 })] },
      isLoading: false,
    });

    renderWithProviders(<EventsPage />);

    const link = screen.getByRole('link', { name: 'my-repo' });
    expect(link).toHaveAttribute('href', '/repos/42');
  });

  it('falls back to the repos list when repositoryId is missing', () => {
    mockUseScanEvents.mockReturnValue({
      data: { count: 1, results: [makeEvent(1, { repoName: 'orphan-repo' })] },
      isLoading: false,
    });

    renderWithProviders(<EventsPage />);

    const link = screen.getByRole('link', { name: 'orphan-repo' });
    expect(link).toHaveAttribute('href', '/repos');
  });

  it('shows locale-aware relative time with the absolute date in the title', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    mockUseScanEvents.mockReturnValue({
      data: { count: 1, results: [makeEvent(1, { createdAt: fiveMinAgo })] },
      isLoading: false,
    });

    renderWithProviders(<EventsPage />);

    const rel = screen.getByText('5 minutes ago');
    // Absolute DD.MM.YYYY HH:mm timestamp preserved in the tooltip
    expect(rel).toHaveAttribute('title', expect.stringMatching(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/));
  });

  it('shows translated metadata labels in the expanded row', async () => {
    const user = userEvent.setup();
    mockUseScanEvents.mockReturnValue({
      data: {
        count: 1,
        results: [makeEvent(1, {
          scanId: 'abcd1234-0000',
          stepName: 'clone',
          resolved: true,
          resolvedAt: '2026-01-11T00:00:00Z',
          resolvedBy: 'admin',
        })],
      },
      isLoading: false,
    });

    renderWithProviders(<EventsPage />);
    await user.click(screen.getByText('Event 1'));

    expect(screen.getByText(/events\.id: 1/)).toBeInTheDocument();
    expect(screen.getByText(/events\.source: scanner/)).toBeInTheDocument();
    expect(screen.getByText(/events\.step: clone/)).toBeInTheDocument();
    expect(screen.getByText(/events\.created:/)).toBeInTheDocument();
    expect(screen.getByText('events.resolvedMetaBy')).toBeInTheDocument();
    // Scan link deep-links to the specific scan
    expect(screen.getByRole('link', { name: 'abcd1234' })).toHaveAttribute('href', '/scans?scan=abcd1234-0000');
  });
});

describe('relative time helper', () => {
  it('formats Ukrainian relative time', async () => {
    const { relativeTime } = await import('./events');
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(relativeTime(threeHoursAgo, 'uk')).toMatch(/год/);
    const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(relativeTime(twoMinAgo, 'uk')).toContain('хвилини тому');
  });
});
