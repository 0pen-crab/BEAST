import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { ReposPage, buildScanBody, DEFAULT_VISIBLE_COLUMNS } from './repos';

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

const mockRepos = [
  { id: 1, name: 'charlie-repo', tags: [], findingsCount: 5, teamId: 1, status: 'completed', updatedAt: '2026-01-10', repoUrl: null, sourceId: null, sizeBytes: 150 * 1024 * 1024, primaryLanguage: 'TypeScript', lastActivityAt: '2024-01-01T00:00:00Z', lastScannedAt: '2026-01-10T12:00:00Z' },
  { id: 2, name: 'alpha-repo', tags: [], findingsCount: 12, teamId: 2, status: 'pending', updatedAt: '2026-02-20', repoUrl: 'https://github.com/org/alpha.git', sourceId: 1, sizeBytes: 5000, primaryLanguage: null, lastActivityAt: '2026-03-01T00:00:00Z', lastScannedAt: null },
  { id: 3, name: 'bravo-repo', tags: [], findingsCount: 0, teamId: 1, status: 'failed', updatedAt: '2026-01-25', repoUrl: null, sourceId: null, sizeBytes: null, primaryLanguage: 'Python', lastActivityAt: null, lastScannedAt: '2026-01-25T08:30:00Z' },
];

vi.mock('@/api/hooks', () => ({
  useRepositories: vi.fn(() => ({
    data: mockRepos,
    isLoading: false,
  })),
  useTeams: vi.fn(() => ({
    data: [{ id: 1, name: 'Team A' }, { id: 2, name: 'Team B' }],
    isLoading: false,
  })),
  useBulkUpdateRepositories: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useTriggerScan: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useSources: vi.fn(() => ({ data: [], isLoading: false })),
  useConnectSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUploadRepoZip: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportFromSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useFindingCountsByTool: vi.fn(() => ({ data: [{ tool: 'beast', active: 5, dismissed: 1 }, { tool: 'gitleaks', active: 3, dismissed: 0 }] })),
  getAuthHeaders: vi.fn(() => ({})),
}));

beforeEach(() => {
  localStorage.clear();
});

describe('ReposPage', () => {
  it('renders the repositories page heading', () => {
    renderWithProviders(<ReposPage />);

    expect(screen.getByRole('heading', { name: 'repos.title' })).toBeInTheDocument();
  });

  it('renders the search input', () => {
    renderWithProviders(<ReposPage />);

    expect(screen.getByPlaceholderText('repos.searchPlaceholder')).toBeInTheDocument();
  });

  it('renders repository rows', () => {
    renderWithProviders(<ReposPage />);

    expect(screen.getByText('charlie-repo')).toBeInTheDocument();
    expect(screen.getByText('alpha-repo')).toBeInTheDocument();
  });

  it('renders default visible table headers', () => {
    renderWithProviders(<ReposPage />);

    expect(screen.getByText('repos.repository')).toBeInTheDocument();
    expect(screen.getByText('repos.statusFilter')).toBeInTheDocument();
    expect(screen.getByText('repos.size')).toBeInTheDocument();
    expect(screen.getByText('repos.findingsCol')).toBeInTheDocument();
  });

  it('hides non-default columns initially', () => {
    renderWithProviders(<ReposPage />);

    // team, source, language, abandoned, lastUpdated are hidden by default
    const headers = screen.getAllByRole('columnheader');
    const headerTexts = headers.map(h => h.textContent);
    expect(headerTexts.join(' ')).not.toContain('repos.team');
    expect(headerTexts.join(' ')).not.toContain('repos.source');
    expect(headerTexts.join(' ')).not.toContain('repos.language');
    expect(headerTexts.join(' ')).not.toContain('repos.maintained');
    expect(headerTexts.join(' ')).not.toContain('repos.lastUpdated');
  });

  it('renders sortable column headers as clickable buttons', () => {
    renderWithProviders(<ReposPage />);

    const headerRow = screen.getAllByRole('columnheader');
    const sortableHeaders = headerRow.filter(
      (th) => th.querySelector('button'),
    );
    // Default: name, status, size, findings = 4 sortable
    expect(sortableHeaders.length).toBeGreaterThanOrEqual(4);
  });

  it('sorts repos by name ascending on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    const nameBtn = screen.getByRole('button', { name: /repos\.repository/i });
    await user.click(nameBtn);

    const rows = screen.getAllByRole('row').slice(1); // skip header
    const names = rows.map((r) => within(r).getAllByRole('cell')[1]?.textContent);
    expect(names[0]).toContain('alpha-repo');
    expect(names[1]).toContain('bravo-repo');
    expect(names[2]).toContain('charlie-repo');
  });

  it('reverses sort direction on second click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    const nameBtn = screen.getByRole('button', { name: /repos\.repository/i });
    await user.click(nameBtn); // asc
    await user.click(nameBtn); // desc

    const rows = screen.getAllByRole('row').slice(1);
    const names = rows.map((r) => within(r).getAllByRole('cell')[1]?.textContent);
    expect(names[0]).toContain('charlie-repo');
    expect(names[2]).toContain('alpha-repo');
  });

  it('sorts repos by findings count', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    const findingsBtn = screen.getByRole('button', { name: /repos\.findingsCol/i });
    await user.click(findingsBtn); // asc

    const rows = screen.getAllByRole('row').slice(1);
    // Default columns: checkbox(0), name(1), status(2), size(3), riskScore(4), findings(5), lastScanned(6), scan(7)
    const findings = rows.map((r) => within(r).getAllByRole('cell')[5]?.textContent?.trim());
    expect(findings).toEqual(['0', '5', '12']);
  });

  it('renders add repositories link to settings', () => {
    renderWithProviders(<ReposPage />);

    const link = screen.getByRole('link', { name: /repos\.addRepo/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/settings#sources');
  });

  it('renders Size column with formatted value', () => {
    renderWithProviders(<ReposPage />);
    expect(screen.getByText('150.0 MB')).toBeInTheDocument();
  });

  // Column visibility
  describe('column visibility', () => {
    it('exports default visible columns', () => {
      expect(DEFAULT_VISIBLE_COLUMNS).toEqual(['status', 'size', 'riskScore', 'findingsCount', 'lastScannedAt']);
    });

    it('renders column settings button', () => {
      renderWithProviders(<ReposPage />);
      expect(screen.getByTitle('repos.columnSettings')).toBeInTheDocument();
    });

    it('opens column settings dropdown on click', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ReposPage />);

      await user.click(screen.getByTitle('repos.columnSettings'));

      // Should show checkboxes for all optional columns
      expect(screen.getByLabelText('repos.statusFilter')).toBeInTheDocument();
      expect(screen.getByLabelText('repos.team')).toBeInTheDocument();
      expect(screen.getByLabelText('repos.source')).toBeInTheDocument();
      expect(screen.getByLabelText('repos.language')).toBeInTheDocument();
      expect(screen.getByLabelText('repos.size')).toBeInTheDocument();
      expect(screen.getByLabelText('repos.maintained')).toBeInTheDocument();
      expect(screen.getByLabelText('repos.findingsCol')).toBeInTheDocument();
      expect(screen.getByLabelText('repos.lastUpdated')).toBeInTheDocument();
    });

    it('toggling a hidden column makes it visible', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ReposPage />);

      // Team column should not be visible by default
      expect(screen.queryByText('repos.team')).not.toBeInTheDocument();

      // Open column settings and toggle team on
      await user.click(screen.getByTitle('repos.columnSettings'));
      await user.click(screen.getByLabelText('repos.team'));

      // Now team header should be visible
      const headers = screen.getAllByRole('columnheader');
      const headerTexts = headers.map(h => h.textContent);
      expect(headerTexts.join(' ')).toContain('repos.team');
    });

    it('toggling a visible column hides it', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ReposPage />);

      // Status column should be visible by default
      const headersBefore = screen.getAllByRole('columnheader');
      expect(headersBefore.map(h => h.textContent).join(' ')).toContain('repos.statusFilter');

      // Open column settings and toggle status off
      await user.click(screen.getByTitle('repos.columnSettings'));
      await user.click(screen.getByLabelText('repos.statusFilter'));

      const headersAfter = screen.getAllByRole('columnheader');
      expect(headersAfter.map(h => h.textContent).join(' ')).not.toContain('repos.statusFilter');
    });

    it('persists column visibility to localStorage', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ReposPage />);

      await user.click(screen.getByTitle('repos.columnSettings'));
      await user.click(screen.getByLabelText('repos.team'));

      const stored = JSON.parse(localStorage.getItem('beast_repo_columns') ?? '[]');
      expect(stored).toContain('team');
    });

    it('restores column visibility from localStorage', () => {
      localStorage.setItem('beast_repo_columns', JSON.stringify(['status', 'team', 'language', 'findingsCount']));
      renderWithProviders(<ReposPage />);

      const headers = screen.getAllByRole('columnheader');
      const headerTexts = headers.map(h => h.textContent).join(' ');
      expect(headerTexts).toContain('repos.team');
      expect(headerTexts).toContain('repos.language');
      expect(headerTexts).not.toContain('repos.size');
    });

    it('shows language column when enabled via settings', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ReposPage />);

      await user.click(screen.getByTitle('repos.columnSettings'));
      await user.click(screen.getByLabelText('repos.language'));

      expect(screen.getByText('TypeScript')).toBeInTheDocument();
      expect(screen.getByText('Python')).toBeInTheDocument();
    });

    it('shows abandoned dots when column enabled', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ReposPage />);

      await user.click(screen.getByTitle('repos.columnSettings'));
      await user.click(screen.getByLabelText('repos.maintained'));

      // charlie-repo has lastActivityAt: '2024-01-01' -> abandoned (red dot)
      const rows = screen.getAllByRole('row').slice(1);
      const charlieRow = rows.find(r => within(r).queryByText('charlie-repo'));
      const cells = within(charlieRow!).getAllByRole('cell');
      // Find the cell with a dot (uses beast-maintained-dot)
      const dotCell = cells.find(c => c.querySelector('.beast-maintained-dot'));
      expect(dotCell).toBeTruthy();
    });
  });
});

describe('buildScanBody', () => {
  it('returns repositoryId from repo object', () => {
    const body = buildScanBody({ id: 42 });
    expect(body).toEqual({ repositoryId: 42 });
  });

  it('returns correct repositoryId for different ids', () => {
    expect(buildScanBody({ id: 1 })).toEqual({ repositoryId: 1 });
    expect(buildScanBody({ id: 100 })).toEqual({ repositoryId: 100 });
    expect(buildScanBody({ id: 999 })).toEqual({ repositoryId: 999 });
  });

  it('only contains repositoryId property', () => {
    const body = buildScanBody({ id: 5 });
    expect(Object.keys(body)).toEqual(['repositoryId']);
  });
});
