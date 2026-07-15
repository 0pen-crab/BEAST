import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderWithProviders } from '@/test-utils';
import { ScansPage, PIPELINE_STAGES, FINDINGS_SUB_STEPS, aggregateFindingsStatus } from './scans';

/** Renders the current URL so tests can assert what the page wrote to it. */
function LocationSpy() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

// jsdom lacks ResizeObserver (needed by ReactFlow inside PipelineProgress)
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

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
  // scans.tsx imports @/lib/i18n (for localized durations), whose init()
  // plugs into react-i18next — the mock must expose the plugin hook.
  initReactI18next: { type: '3rdParty', init: () => {} },
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

const mockUseScans = vi.fn();
const mockUseScanStats = vi.fn();
const mockUseScanDetail = vi.fn();
const mockRemoveMutate = vi.fn();
const mockCancelMutate = vi.fn();

vi.mock('@/api/hooks', () => ({
  useScans: (...args: unknown[]) => mockUseScans(...args),
  useScanStats: () => mockUseScanStats(),
  useScanDetail: (...args: unknown[]) => mockUseScanDetail(...args),
  useScanLogs: vi.fn(() => ({
    data: [],
  })),
  useScanLogContent: vi.fn(() => ({
    data: null,
    isLoading: false,
  })),
  useCancelScan: () => ({
    mutate: mockCancelMutate,
    isPending: false,
  }),
  useRemoveScan: () => ({
    mutate: mockRemoveMutate,
    isPending: false,
  }),
  useResumeScan: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

beforeEach(() => {
  mockUseScans.mockReset();
  mockUseScanStats.mockReset();
  mockUseScanDetail.mockReset();
  mockRemoveMutate.mockReset();
  mockCancelMutate.mockReset();
  mockUseScans.mockReturnValue({ data: { count: 0, results: [] }, isLoading: false });
  mockUseScanDetail.mockReturnValue({ data: null });
  mockUseScanStats.mockReturnValue({
    data: { total: 10, queued: 2, running: 1, completed: 6, failed: 1, avg_duration_sec: 120 },
  });
});

function makeScan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scan-1',
    status: 'queued',
    repoName: 'my-repo',
    scanType: 'full',
    error: null,
    durationMs: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-10T00:00:00Z',
    steps: [],
    ...overrides,
  };
}

describe('PIPELINE_STAGES', () => {
  it('shows 6 display stages — triage/mitigation/commit fold into one findings stage', () => {
    expect(PIPELINE_STAGES.map(s => s.key)).toEqual([
      'clone',
      'analysis',
      'security-tools',
      'ai-research',
      'import',
      'findings',
    ]);
  });

  it('every stage has a scans.stages.* label key (used for step counts like "N/6 steps")', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(stage.labelKey).toBe(`scans.stages.${stage.key}`);
    }
    expect(PIPELINE_STAGES).toHaveLength(6);
  });

  it('the findings stage folds exactly the three findings-work backend steps', () => {
    expect(FINDINGS_SUB_STEPS).toEqual(['triage-report', 'mitigation-check', 'commit']);
  });
});

// ── Findings stage status aggregation ──────────────────────────
// The displayed 'findings' stage covers three sequential backend steps —
// its status must reflect the WHOLE group.

describe('aggregateFindingsStatus', () => {
  const sub = (statuses: Record<string, string>) =>
    Object.entries(statuses).map(([stepName, status]) => ({ stepName, status }) as any);

  it('is pending when no sub-step ran', () => {
    expect(aggregateFindingsStatus(sub({ 'triage-report': 'pending', 'mitigation-check': 'pending', 'commit': 'pending' }))).toBe('pending');
    expect(aggregateFindingsStatus([])).toBe('pending');
  });

  it('is running while any sub-step runs', () => {
    expect(aggregateFindingsStatus(sub({ 'triage-report': 'running', 'mitigation-check': 'pending', 'commit': 'pending' }))).toBe('running');
  });

  it('is running BETWEEN sub-steps (some completed, rest pending) — the group is not done', () => {
    expect(aggregateFindingsStatus(sub({ 'triage-report': 'completed', 'mitigation-check': 'pending', 'commit': 'pending' }))).toBe('running');
    expect(aggregateFindingsStatus(sub({ 'triage-report': 'completed', 'mitigation-check': 'completed', 'commit': 'pending' }))).toBe('running');
  });

  it('is failed when any sub-step failed', () => {
    expect(aggregateFindingsStatus(sub({ 'triage-report': 'completed', 'mitigation-check': 'failed', 'commit': 'pending' }))).toBe('failed');
  });

  it('is completed only when every sub-step completed (skipped counts as done)', () => {
    expect(aggregateFindingsStatus(sub({ 'triage-report': 'completed', 'mitigation-check': 'completed', 'commit': 'completed' }))).toBe('completed');
    expect(aggregateFindingsStatus(sub({ 'triage-report': 'skipped', 'mitigation-check': 'skipped', 'commit': 'completed' }))).toBe('completed');
  });

  it('is skipped when every sub-step was skipped', () => {
    expect(aggregateFindingsStatus(sub({ 'triage-report': 'skipped', 'mitigation-check': 'skipped', 'commit': 'skipped' }))).toBe('skipped');
  });
});

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

  it('renders card skeletons instead of nothing while stats are loading', () => {
    mockUseScanStats.mockReturnValue({ data: undefined });

    const { container } = renderWithProviders(<ScansPage />);

    expect(container.querySelectorAll('.beast-skeleton').length).toBeGreaterThan(0);
  });
});

describe('queue position numbers', () => {
  it('numbers queued rows in FIFO order', () => {
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'queued') {
        return {
          data: {
            count: 2,
            results: [makeScan(), makeScan({ id: 'scan-2', repoName: 'second-repo' })],
          },
          isLoading: false,
        };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });
    renderWithProviders(<ScansPage />);

    const cells = document.querySelectorAll('.beast-td-queue-pos');
    expect(Array.from(cells).map(c => c.textContent)).toEqual(['1', '2']);
  });

  it('does not render a position column on the completed tab', async () => {
    const user = userEvent.setup();
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'completed') {
        return {
          data: { count: 1, results: [makeScan({ status: 'completed', completedAt: '2026-01-10T01:00:00Z' })] },
          isLoading: false,
        };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });
    renderWithProviders(<ScansPage />);

    await user.click(screen.getByRole('button', { name: 'scans.completed' }));

    expect(document.querySelector('.beast-td-queue-pos')).toBeNull();
  });
});

describe('remove confirmation', () => {
  function withQueuedScan() {
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'queued') {
        return { data: { count: 1, results: [makeScan()] }, isLoading: false };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });
  }

  it('opens a confirmation modal instead of removing immediately', async () => {
    const user = userEvent.setup();
    withQueuedScan();
    renderWithProviders(<ScansPage />);

    await user.click(screen.getByTitle('scans.removeFromQueue'));

    expect(mockRemoveMutate).not.toHaveBeenCalled();
    expect(screen.getByText('scans.removeScan')).toBeInTheDocument();
    expect(screen.getByText('my-repo', { selector: 'strong' })).toBeInTheDocument();
  });

  it('removes the scan only after confirming', async () => {
    const user = userEvent.setup();
    withQueuedScan();
    renderWithProviders(<ScansPage />);

    await user.click(screen.getByTitle('scans.removeFromQueue'));
    await user.click(screen.getByRole('button', { name: 'common.remove' }));

    expect(mockRemoveMutate).toHaveBeenCalledWith('scan-1', expect.anything());
  });

  it('does not remove when cancelled', async () => {
    const user = userEvent.setup();
    withQueuedScan();
    renderWithProviders(<ScansPage />);

    await user.click(screen.getByTitle('scans.removeFromQueue'));
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(mockRemoveMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('scans.removeScan')).not.toBeInTheDocument();
  });
});

describe('cancel action for paused scans', () => {
  it('shows the cancel button on a paused running-card', () => {
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'paused') {
        return {
          data: { count: 1, results: [makeScan({ id: 'scan-p', status: 'paused', startedAt: '2026-01-10T00:00:00Z' })] },
          isLoading: false,
        };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });

    renderWithProviders(<ScansPage />);

    expect(screen.getByTitle('scans.cancelScan')).toBeInTheDocument();
  });

  it('shows the cancel action for a paused scan row', async () => {
    const user = userEvent.setup();
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'queued') {
        return {
          data: { count: 1, results: [makeScan({ id: 'scan-p2', status: 'paused' })] },
          isLoading: false,
        };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });

    renderWithProviders(<ScansPage />);

    const cancelButtons = screen.getAllByTitle('scans.cancelScan');
    await user.click(cancelButtons[cancelButtons.length - 1]);
    expect(mockCancelMutate).toHaveBeenCalledWith('scan-p2');
  });
});

describe('deep link highlight (?scan=)', () => {
  it('switches to the completed tab and highlights the deep-linked scan row', () => {
    const completedScan = makeScan({ id: 'scan-c', status: 'completed', completedAt: '2026-01-10T01:00:00Z' });
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'completed') {
        return { data: { count: 1, results: [completedScan] }, isLoading: false };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });
    // ScansPage resolves the target scan via useScanDetail to pick the tab
    mockUseScanDetail.mockImplementation((id: string | null) =>
      id === 'scan-c' ? { data: completedScan } : { data: null });

    const { container } = renderWithProviders(<ScansPage />, {
      initialEntries: ['/scans?scan=scan-c'],
    });

    // Tab switched to completed → the scan row is rendered and highlighted
    expect(screen.getByText('my-repo')).toBeInTheDocument();
    expect(container.querySelector('.beast-row-highlight')).toBeInTheDocument();
  });

  it('auto-expands the deep-linked scan row, not just scroll+highlight', () => {
    const completedScan = makeScan({
      id: 'scan-c', status: 'completed', completedAt: '2026-01-10T01:00:00Z',
      completedWithErrors: true,
      stepErrors: [{ kind: 'tool', name: 'semgrep', error: 'network timeout', failedAfterRetry: true }],
      steps: [{ id: 1, scanId: 'scan-c', stepName: 'clone', stepOrder: 1, status: 'completed', input: null, output: null, error: null, artifactsPath: null, startedAt: null, completedAt: null }],
    });
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'completed') {
        return { data: { count: 1, results: [completedScan] }, isLoading: false };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });
    mockUseScanDetail.mockImplementation((id: string | null) =>
      id === 'scan-c' ? { data: completedScan } : { data: null });

    renderWithProviders(<ScansPage />, {
      initialEntries: ['/scans?scan=scan-c&tab=completed'],
    });

    // Expanded detail (here: the step-errors section) is visible WITHOUT a click
    expect(screen.getByTestId('scan-step-errors')).toBeInTheDocument();
  });

  it('lets ?scan= win over a conflicting ?tab= param', () => {
    const completedScan = makeScan({ id: 'scan-c', status: 'completed', completedAt: '2026-01-10T01:00:00Z' });
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'completed') {
        return { data: { count: 1, results: [completedScan] }, isLoading: false };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });
    mockUseScanDetail.mockImplementation((id: string | null) =>
      id === 'scan-c' ? { data: completedScan } : { data: null });

    renderWithProviders(<ScansPage />, {
      initialEntries: ['/scans?scan=scan-c&tab=failed'],
    });

    // The deep-linked scan is completed → its tab wins over ?tab=failed
    expect(screen.getByText('my-repo')).toBeInTheDocument();
    expect(screen.queryByText('scans.noFailedScans')).not.toBeInTheDocument();
  });
});

describe('tab in URL (?tab=)', () => {
  const location = () => screen.getByTestId('location').textContent ?? '';

  it('restores the completed tab from ?tab=completed on mount', () => {
    renderWithProviders(<ScansPage />, { initialEntries: ['/scans?tab=completed'] });

    expect(screen.getByText('scans.noCompletedScans')).toBeInTheDocument();
  });

  it('restores the failed tab from ?tab=failed on mount', () => {
    renderWithProviders(<ScansPage />, { initialEntries: ['/scans?tab=failed'] });

    expect(screen.getByText('scans.noFailedScans')).toBeInTheDocument();
  });

  it('falls back to the active tab for an unknown ?tab= value', () => {
    renderWithProviders(<ScansPage />, { initialEntries: ['/scans?tab=bogus'] });

    expect(screen.getByText('scans.noScansInQueue')).toBeInTheDocument();
  });

  it('writes ?tab= on switch and removes it for the default (active) tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<><ScansPage /><LocationSpy /></>, { initialEntries: ['/scans'] });

    await user.click(screen.getByRole('button', { name: 'scans.completed' }));
    expect(location()).toBe('/scans?tab=completed');
    expect(screen.getByText('scans.noCompletedScans')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scans.queue' }));
    expect(location()).toBe('/scans');
    expect(screen.getByText('scans.noScansInQueue')).toBeInTheDocument();
  });

  it('drops the ?scan= deep link when the user switches tabs manually', async () => {
    const completedScan = makeScan({ id: 'scan-c', status: 'completed', completedAt: '2026-01-10T01:00:00Z' });
    mockUseScanDetail.mockImplementation((id: string | null) =>
      id === 'scan-c' ? { data: completedScan } : { data: null });
    const user = userEvent.setup();
    renderWithProviders(<><ScansPage /><LocationSpy /></>, {
      initialEntries: ['/scans?scan=scan-c'],
    });

    // Deep link resolved → tab rewritten in place alongside the scan param
    expect(location()).toBe('/scans?scan=scan-c&tab=completed');

    await user.click(screen.getByRole('button', { name: 'scans.failed' }));
    expect(location()).toBe('/scans?tab=failed');
  });
});

describe('completed with errors', () => {
  function mockCompletedList(scan: Record<string, unknown>) {
    mockUseScans.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'completed') {
        return { data: { count: 1, results: [scan] }, isLoading: false };
      }
      return { data: { count: 0, results: [] }, isLoading: false };
    });
  }

  it('renders the amber "completed with errors" badge with a tooltip instead of the green completed pill', () => {
    const scan = makeScan({
      id: 'scan-e', status: 'completed', completedAt: '2026-01-10T01:00:00Z',
      completedWithErrors: true,
      stepErrors: [{ kind: 'tool', name: 'semgrep', error: 'network timeout', failedAfterRetry: true }],
    });
    mockCompletedList(scan);

    const { container } = renderWithProviders(<ScansPage />, { initialEntries: ['/scans?tab=completed'] });

    // Amber label replaces the plain completed status text
    const pill = screen.getByText('scans.completedWithErrors');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute('title', 'scans.completedWithErrorsTooltip');
    expect(pill.className).toContain('status-paused'); // amber pill style
    expect(screen.queryByText('status.completed')).not.toBeInTheDocument();
    // Distinct warning icon instead of the green check
    expect(container.textContent).toContain('⚠');
  });

  it('keeps the normal green completed pill for clean scans', () => {
    const scan = makeScan({
      id: 'scan-ok', status: 'completed', completedAt: '2026-01-10T01:00:00Z',
      completedWithErrors: false, stepErrors: [],
    });
    mockCompletedList(scan);

    renderWithProviders(<ScansPage />, { initialEntries: ['/scans?tab=completed'] });

    expect(screen.getByText('status.completed')).toBeInTheDocument();
    expect(screen.queryByText('scans.completedWithErrors')).not.toBeInTheDocument();
  });

  it('shows a detailed errors section in the expanded scan view (name, error text, retry info)', async () => {
    const scan = makeScan({
      id: 'scan-e', status: 'completed', completedAt: '2026-01-10T01:00:00Z',
      completedWithErrors: true,
      stepErrors: [
        { kind: 'tool', name: 'semgrep', error: 'failed after retry: network timeout', failedAfterRetry: true },
        { kind: 'module', name: 'src/api', error: 'failed after retry — attempt 1: context overflow; attempt 2: context overflow', failedAfterRetry: true },
      ],
      steps: [{ id: 1, scanId: 'scan-e', stepName: 'clone', stepOrder: 1, status: 'completed', input: null, output: null, error: null, artifactsPath: null, startedAt: null, completedAt: null }],
    });
    mockCompletedList(scan);
    mockUseScanDetail.mockImplementation((id: string | null) =>
      id === 'scan-e' ? { data: scan } : { data: null });

    const user = userEvent.setup();
    renderWithProviders(<ScansPage />, { initialEntries: ['/scans?tab=completed'] });

    await user.click(screen.getByText('my-repo'));

    const section = screen.getByTestId('scan-step-errors');
    expect(section).toBeInTheDocument();
    expect(section.textContent).toContain('scans.stepErrorsTitle');
    // Tool error: kind label + name + detailed text + retry info
    expect(section.textContent).toContain('scans.stepErrorTool');
    expect(section.textContent).toContain('semgrep');
    expect(section.textContent).toContain('failed after retry: network timeout');
    // Module error
    expect(section.textContent).toContain('scans.stepErrorModule');
    expect(section.textContent).toContain('src/api');
    expect(section.textContent).toContain('attempt 2: context overflow');
    // Attempt info label rendered for retried entries
    expect(section.textContent).toContain('scans.failedAfterRetry');
  });

  it('does NOT render the errors section for a clean completed scan', async () => {
    const scan = makeScan({
      id: 'scan-ok', status: 'completed', completedAt: '2026-01-10T01:00:00Z',
      completedWithErrors: false, stepErrors: [],
      steps: [{ id: 1, scanId: 'scan-ok', stepName: 'clone', stepOrder: 1, status: 'completed', input: null, output: null, error: null, artifactsPath: null, startedAt: null, completedAt: null }],
    });
    mockCompletedList(scan);
    mockUseScanDetail.mockImplementation((id: string | null) =>
      id === 'scan-ok' ? { data: scan } : { data: null });

    const user = userEvent.setup();
    renderWithProviders(<ScansPage />, { initialEntries: ['/scans?tab=completed'] });

    await user.click(screen.getByText('my-repo'));
    expect(screen.queryByTestId('scan-step-errors')).not.toBeInTheDocument();
  });
});
