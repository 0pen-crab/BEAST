import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderWithProviders } from '@/test-utils';
import { ReposPage, buildScanBody, parseRangeFilter, DEFAULT_VISIBLE_COLUMNS } from './repos';

/** Renders the current URL so tests can assert what the page wrote to it. */
function LocationSpy() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

const mockApiFetch = vi.fn();
vi.mock('@/api/client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  fetchApi: vi.fn(),
}));

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

const mockTriggerScanAsync = vi.fn();

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
    mutateAsync: (...args: unknown[]) => mockTriggerScanAsync(...args),
    isPending: false,
  })),
  useSources: vi.fn(() => ({ data: [], isLoading: false })),
  useConnectSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUploadRepoZip: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportFromSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useFindingCountsByTool: vi.fn(() => ({ data: [{ tool: 'beast', active: 5, dismissed: 1 }, { tool: 'gitleaks', active: 3, dismissed: 0 }] })),
  getAuthHeaders: vi.fn(() => ({})),
}));

const { useRepositories } = await import('@/api/hooks');

beforeEach(() => {
  localStorage.clear();
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  mockTriggerScanAsync.mockReset();
  mockTriggerScanAsync.mockResolvedValue({});
  vi.mocked(useRepositories).mockImplementation(() => (
    { data: mockRepos, isLoading: false } as unknown as ReturnType<typeof useRepositories>
  ));
});

describe('ReposPage', () => {
  it('renders the repositories page heading', () => {
    renderWithProviders(<ReposPage />);

    expect(screen.getByRole('heading', { name: 'repos.title' })).toBeInTheDocument();
  });

  it('renders the translated repository count as subtitle', () => {
    renderWithProviders(<ReposPage />);

    // t() mock returns the key — the count line goes through repos.count
    expect(screen.getByText('repos.count')).toBeInTheDocument();
  });

  it('renders the translated subtitle while repos are not loaded yet', () => {
    vi.mocked(useRepositories).mockImplementation(() => (
      { data: undefined, isLoading: true } as unknown as ReturnType<typeof useRepositories>
    ));
    renderWithProviders(<ReposPage />);

    expect(screen.getByText('repos.subtitle')).toBeInTheDocument();
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

describe('page clamping', () => {
  it('clamps to the last available page when the filtered list shrinks', async () => {
    const many = Array.from({ length: 26 }, (_, i) => ({
      ...mockRepos[0], id: i + 1, name: `repo-${String(i).padStart(2, '0')}`,
    }));
    vi.mocked(useRepositories).mockImplementation(() => (
      { data: many, isLoading: false } as unknown as ReturnType<typeof useRepositories>
    ));
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<ReposPage />);

    // Go to page 2 — only repo-25 lives there
    await user.click(screen.getByRole('button', { name: 'common.page 2' }));
    expect(screen.getByText('repo-25')).toBeInTheDocument();
    expect(screen.queryByText('repo-00')).not.toBeInTheDocument();

    // List shrinks to a single page (e.g. bulk delete on the last page + refetch)
    vi.mocked(useRepositories).mockImplementation(() => (
      { data: many.slice(0, 3), isLoading: false } as unknown as ReturnType<typeof useRepositories>
    ));
    rerender(<ReposPage />);

    // Page is clamped back into range instead of stranding the user on an empty page
    expect(screen.getByText('repo-00')).toBeInTheDocument();
    expect(screen.queryByText('repos.noReposFound')).not.toBeInTheDocument();
  });
});

describe('last updated sort', () => {
  it('sorts the Last updated column by lastActivityAt (the displayed value)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('beast_repo_columns', JSON.stringify(['updatedAt']));
    renderWithProviders(<ReposPage />);

    const btn = screen.getByRole('button', { name: /repos\.lastUpdated/i });
    await user.click(btn); // asc

    const rows = screen.getAllByRole('row').slice(1);
    const names = rows.map((r) => within(r).getAllByRole('cell')[1]?.textContent);
    // lastActivityAt asc: bravo (null → ''), charlie (2024-01-01), alpha (2026-03-01)
    expect(names[0]).toContain('bravo-repo');
    expect(names[1]).toContain('charlie-repo');
    expect(names[2]).toContain('alpha-repo');
  });
});

describe('bulk action error handling', () => {
  async function selectAllOnPage(user: ReturnType<typeof userEvent.setup>) {
    const headerCheckbox = screen.getAllByRole('checkbox')[0];
    await user.click(headerCheckbox);
  }

  it('shows an inline error and re-enables buttons when bulk scan fails', async () => {
    mockTriggerScanAsync.mockRejectedValue(new Error('queue unavailable'));
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    await selectAllOnPage(user);
    await user.click(screen.getByRole('button', { name: /repos\.scanSelected/ }));

    expect(await screen.findByText('queue unavailable')).toBeInTheDocument();
    // bulkLoading was reset — the scan button is enabled again with its idle label
    const scanBtn = screen.getByRole('button', { name: /repos\.scanSelected/ });
    expect(scanBtn).toBeEnabled();
  });

  it('reports per-repo failures and resets loading when bulk delete partially fails', async () => {
    // First delete fails (500), the rest succeed
    mockApiFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    await selectAllOnPage(user);
    await user.click(screen.getByRole('button', { name: /repos\.deleteSelected/ }));
    await user.click(screen.getByRole('button', { name: 'common.delete' }));

    expect(await screen.findByText('repos.bulkDeleteFailed')).toBeInTheDocument();
    const deleteBtn = screen.getByRole('button', { name: /repos\.deleteSelected/ });
    expect(deleteBtn).toBeEnabled();
  });

  it('does not show an error when bulk delete succeeds for all repos', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    await selectAllOnPage(user);
    await user.click(screen.getByRole('button', { name: /repos\.deleteSelected/ }));
    await user.click(screen.getByRole('button', { name: 'common.delete' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(3);
    });
    expect(screen.queryByText('repos.bulkDeleteFailed')).not.toBeInTheDocument();
  });
});

describe('bulk delete confirmation modal', () => {
  async function selectAllOnPage(user: ReturnType<typeof userEvent.setup>) {
    const headerCheckbox = screen.getAllByRole('checkbox')[0];
    await user.click(headerCheckbox);
  }

  it('opens a styled confirm modal with the repo count instead of native confirm()', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    await selectAllOnPage(user);
    await user.click(screen.getByRole('button', { name: /repos\.deleteSelected/ }));

    // Modal appears; nothing is deleted yet
    expect(screen.getByText('repos.bulkDeleteTitle')).toBeInTheDocument();
    expect(screen.getByText('repos.bulkDeleteConfirm')).toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('cancelling the modal deletes nothing and keeps the selection', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    await selectAllOnPage(user);
    await user.click(screen.getByRole('button', { name: /repos\.deleteSelected/ }));
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(screen.queryByText('repos.bulkDeleteTitle')).not.toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
    // Selection is still active — the bulk bar is still shown
    expect(screen.getByText(/common\.selected/)).toBeInTheDocument();
  });

  it('confirming the modal performs the deletions', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    await selectAllOnPage(user);
    await user.click(screen.getByRole('button', { name: /repos\.deleteSelected/ }));
    await user.click(screen.getByRole('button', { name: 'common.delete' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(3);
    });
    expect(screen.queryByText('repos.bulkDeleteTitle')).not.toBeInTheDocument();
  });
});

describe('selection reset on filter change', () => {
  it('clears the selection when the search term changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    // Select all rows on the page — bulk bar appears
    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText(/common\.selected/)).toBeInTheDocument();

    // Typing a search term must reset the selection (rows may become hidden)
    await user.type(screen.getByPlaceholderText('repos.searchPlaceholder'), 'alpha');
    expect(screen.queryByText(/common\.selected/)).not.toBeInTheDocument();
  });

  it('keeps the selection across pagination (no filter criteria change)', async () => {
    const many = Array.from({ length: 26 }, (_, i) => ({
      ...mockRepos[0], id: i + 1, name: `repo-${String(i).padStart(2, '0')}`,
    }));
    vi.mocked(useRepositories).mockImplementation(() => (
      { data: many, isLoading: false } as unknown as ReturnType<typeof useRepositories>
    ));
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText(/common\.selected/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'common.page 2' }));

    // Selection survives a page change
    expect(screen.getByText(/common\.selected/)).toBeInTheDocument();
  });
});

describe('team assign dropdown', () => {
  it('does not style team items with the danger class', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReposPage />);

    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: /repos\.assignToTeam/ }));

    const teamItem = screen.getByRole('button', { name: 'Team A' });
    expect(teamItem.className).toContain('beast-dropdown-item');
    expect(teamItem.className).not.toContain('beast-dropdown-item-danger');
  });
});

describe('URL state sync', () => {
  const location = () => screen.getByTestId('location').textContent ?? '';

  describe('mount from URL restores state', () => {
    it('restores the search text from ?q=', () => {
      renderWithProviders(<ReposPage />, { initialEntries: ['/repos?q=alpha'] });

      expect(screen.getByPlaceholderText('repos.searchPlaceholder')).toHaveValue('alpha');
      expect(screen.getByText('alpha-repo')).toBeInTheDocument();
      expect(screen.queryByText('charlie-repo')).not.toBeInTheDocument();
    });

    it('restores the status filter from ?status=', () => {
      renderWithProviders(<ReposPage />, { initialEntries: ['/repos?status=failed'] });

      expect(screen.getByText('bravo-repo')).toBeInTheDocument();
      expect(screen.queryByText('alpha-repo')).not.toBeInTheDocument();
      expect(screen.queryByText('charlie-repo')).not.toBeInTheDocument();
    });

    it('restores a chip filter (team) from ?team=', () => {
      renderWithProviders(<ReposPage />, { initialEntries: ['/repos?team=2'] });

      expect(screen.getByText('alpha-repo')).toBeInTheDocument();
      expect(screen.queryByText('bravo-repo')).not.toBeInTheDocument();
    });

    it('restores a range chip filter (size in bytes) from ?size=', () => {
      renderWithProviders(<ReposPage />, { initialEntries: ['/repos?size=10000..'] });

      // Only charlie-repo (150 MB) is >= 10000 bytes; alpha is 5000, bravo null
      expect(screen.getByText('charlie-repo')).toBeInTheDocument();
      expect(screen.queryByText('alpha-repo')).not.toBeInTheDocument();
      expect(screen.queryByText('bravo-repo')).not.toBeInTheDocument();
    });

    it('restores the abandoned filter from ?abandoned=', () => {
      renderWithProviders(<ReposPage />, { initialEntries: ['/repos?abandoned=active'] });

      // charlie-repo is abandoned (lastActivityAt 2024) → hidden
      expect(screen.getByText('alpha-repo')).toBeInTheDocument();
      expect(screen.getByText('bravo-repo')).toBeInTheDocument();
      expect(screen.queryByText('charlie-repo')).not.toBeInTheDocument();
    });

    it('restores sort field and direction from ?sort= and ?dir=', () => {
      renderWithProviders(<ReposPage />, { initialEntries: ['/repos?sort=name&dir=desc'] });

      const rows = screen.getAllByRole('row').slice(1);
      const names = rows.map((r) => within(r).getAllByRole('cell')[1]?.textContent);
      expect(names[0]).toContain('charlie-repo');
      expect(names[2]).toContain('alpha-repo');
    });

    it('restores the page from ?page= (1-based)', () => {
      const many = Array.from({ length: 26 }, (_, i) => ({
        ...mockRepos[0], id: i + 1, name: `repo-${String(i).padStart(2, '0')}`,
      }));
      vi.mocked(useRepositories).mockImplementation(() => (
        { data: many, isLoading: false } as unknown as ReturnType<typeof useRepositories>
      ));
      renderWithProviders(<ReposPage />, { initialEntries: ['/repos?page=2'] });

      expect(screen.getByText('repo-25')).toBeInTheDocument();
      expect(screen.queryByText('repo-00')).not.toBeInTheDocument();
    });

    it('ignores an invalid ?sort= value', () => {
      renderWithProviders(<><ReposPage /><LocationSpy /></>, { initialEntries: ['/repos?sort=nope'] });

      // Invalid sort is dropped from state and cleaned out of the URL
      expect(location()).toBe('/repos');
    });
  });

  describe('state changes write the URL', () => {
    it('writes the search text to ?q= and removes it when cleared', async () => {
      const user = userEvent.setup();
      renderWithProviders(<><ReposPage /><LocationSpy /></>, { initialEntries: ['/repos'] });

      const input = screen.getByPlaceholderText('repos.searchPlaceholder');
      await user.type(input, 'alpha');
      expect(location()).toBe('/repos?q=alpha');

      await user.clear(input);
      expect(location()).toBe('/repos');
    });

    it('writes sort to ?sort= (dir only when desc)', async () => {
      const user = userEvent.setup();
      renderWithProviders(<><ReposPage /><LocationSpy /></>, { initialEntries: ['/repos'] });

      const nameBtn = screen.getByRole('button', { name: /repos\.repository/i });
      await user.click(nameBtn); // asc — default dir stays out of the URL
      expect(location()).toBe('/repos?sort=name');

      await user.click(nameBtn); // desc
      expect(location()).toBe('/repos?sort=name&dir=desc');
    });

    it('writes the page to ?page= (1-based) and removes it on the first page', async () => {
      const many = Array.from({ length: 26 }, (_, i) => ({
        ...mockRepos[0], id: i + 1, name: `repo-${String(i).padStart(2, '0')}`,
      }));
      vi.mocked(useRepositories).mockImplementation(() => (
        { data: many, isLoading: false } as unknown as ReturnType<typeof useRepositories>
      ));
      const user = userEvent.setup();
      renderWithProviders(<><ReposPage /><LocationSpy /></>, { initialEntries: ['/repos'] });

      await user.click(screen.getByRole('button', { name: 'common.page 2' }));
      expect(location()).toBe('/repos?page=2');

      await user.click(screen.getByRole('button', { name: 'common.page 1' }));
      expect(location()).toBe('/repos');
    });

    it('removes a chip filter param when its chip is removed', async () => {
      const user = userEvent.setup();
      renderWithProviders(<><ReposPage /><LocationSpy /></>, { initialEntries: ['/repos?status=failed'] });

      expect(location()).toBe('/repos?status=failed');
      await user.click(screen.getByTitle('common.remove'));
      expect(location()).toBe('/repos');
    });
  });

  it('keeps the URL clean on a default view', () => {
    renderWithProviders(<><ReposPage /><LocationSpy /></>, { initialEntries: ['/repos'] });

    expect(location()).toBe('/repos');
  });

  it('still resets selection and page when the search changes (behavior preserved)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<><ReposPage /><LocationSpy /></>, { initialEntries: ['/repos'] });

    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText(/common\.selected/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('repos.searchPlaceholder'), 'alpha');
    expect(screen.queryByText(/common\.selected/)).not.toBeInTheDocument();
    expect(location()).toBe('/repos?q=alpha');
  });
});

describe('parseRangeFilter', () => {
  const numeric = (raw: string) => {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  };

  it('parses valid min/max values', () => {
    expect(parseRangeFilter('3..8', numeric)).toEqual({ min: 3, max: 8 });
    expect(parseRangeFilter('3..', numeric)).toEqual({ min: 3, max: undefined });
    expect(parseRangeFilter('..8', numeric)).toEqual({ min: undefined, max: 8 });
  });

  it('returns null when both bounds are invalid or empty', () => {
    expect(parseRangeFilter('abc..xyz', numeric)).toBeNull();
    expect(parseRangeFilter('..', numeric)).toBeNull();
    expect(parseRangeFilter('', numeric)).toBeNull();
  });

  it('drops an invalid bound but keeps the valid one', () => {
    expect(parseRangeFilter('abc..8', numeric)).toEqual({ min: undefined, max: 8 });
    expect(parseRangeFilter('3..abc', numeric)).toEqual({ min: 3, max: undefined });
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
