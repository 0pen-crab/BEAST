import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderWithProviders } from '@/test-utils';
import { FindingsPage } from './findings';

/** Renders the current URL so tests can assert what the page wrote to it. */
function LocationSpy() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

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

const defaultFindingsResult = () => ({
  data: {
    count: 2,
    results: [
      {
        id: 1,
        title: 'SQL Injection',
        severity: 'High',
        status: 'open',
        filePath: 'src/db.ts',
        line: 42,
        tool: 'semgrep',
        cvssScore: 8.5,
        testId: 1,
        repositoryId: 1,
        contributorId: 10,
        contributorName: 'John Doe',
        createdAt: '2026-01-10T00:00:00Z',
        duplicateCount: 2,
      },
      {
        id: 2,
        title: 'XSS Vulnerability',
        severity: 'Critical',
        status: 'open',
        filePath: 'src/render.tsx',
        line: 10,
        tool: 'gitleaks',
        cvssScore: null,
        testId: 2,
        repositoryId: 1,
        contributorId: null,
        contributorName: null,
        createdAt: '2026-01-12T00:00:00Z',
      },
    ],
  },
  isLoading: false,
});

type MockFindingsResult = { data: { count: number; results: unknown[] }; isLoading: boolean };
const mockUseFindings = vi.fn((..._args: unknown[]): MockFindingsResult => defaultFindingsResult());

const mockFetchApiRaw = vi.fn();
vi.mock('@/api/client', () => ({
  fetchApiRaw: (...args: unknown[]) => mockFetchApiRaw(...args),
}));

vi.mock('@/api/hooks', () => ({
  useFindings: (...args: unknown[]) => mockUseFindings(...args),
  useRepositories: vi.fn(() => ({
    data: [{ id: 1, name: 'repo-1' }],
    isLoading: false,
  })),
  useSources: vi.fn(() => ({
    data: [{ id: 1, provider: 'gitlab', baseUrl: 'https://gitlab.example.com', orgName: null }],
    isLoading: false,
  })),
}));

beforeEach(() => {
  localStorage.clear();
  mockUseFindings.mockReset();
  mockUseFindings.mockImplementation(defaultFindingsResult);
  mockFetchApiRaw.mockReset();
  mockFetchApiRaw.mockResolvedValue({
    blob: () => Promise.resolve(new Blob(['col1,col2'], { type: 'text/csv' })),
  });
});

describe('FindingsPage', () => {
  it('renders the findings page heading', () => {
    renderWithProviders(<FindingsPage />);
    expect(screen.getByRole('heading', { name: 'findings.title' })).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    renderWithProviders(<FindingsPage />);
    expect(screen.getByText('findings.subtitle')).toBeInTheDocument();
  });

  it('renders findings in the table', () => {
    renderWithProviders(<FindingsPage />);
    expect(screen.getByText('SQL Injection')).toBeInTheDocument();
    expect(screen.getByText('src/db.ts:42')).toBeInTheDocument();
  });

  it('renders repository and contributor columns', () => {
    renderWithProviders(<FindingsPage />);
    // Repo name linked from repo map (appears for both findings)
    const repoLinks = screen.getAllByText('repo-1');
    expect(repoLinks.length).toBe(2);
    expect(repoLinks[0].closest('a')).toHaveAttribute('href', '/repos/1');
    // Contributor name linked (only first finding has one)
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('John Doe').closest('a')).toHaveAttribute('href', '/contributors/10');
  });

  it('renders sortable column headers as buttons', () => {
    renderWithProviders(<FindingsPage />);
    // Finding column header is a sortable button
    expect(screen.getByRole('button', { name: /findings\.finding/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /findings\.severity/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /findings\.status/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /findings\.date/ })).toBeInTheDocument();
  });

  it('renders chip filter with search', () => {
    renderWithProviders(<FindingsPage />);
    expect(screen.getByText(/common.addFilter/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('findings.searchPlaceholder')).toBeInTheDocument();
  });

  it('renders column settings gear button', () => {
    renderWithProviders(<FindingsPage />);
    expect(screen.getByTitle('findings.columnSettings')).toBeInTheDocument();
  });

  it('passes sort params to useFindings when a column header is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindingsPage />);

    const severityBtn = screen.getByRole('button', { name: /findings\.severity/ });
    await user.click(severityBtn);

    // Check that useFindings was called with sort params
    const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ sort: 'severity', dir: 'asc' });
  });

  it('passes source_id to useFindings when ?source= is in the URL', () => {
    renderWithProviders(<FindingsPage />, { initialEntries: ['/findings?source=1'] });
    const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ source_id: 1 });
  });

  it('toggles sort direction on second click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindingsPage />);

    const severityBtn = screen.getByRole('button', { name: /findings\.severity/ });
    await user.click(severityBtn);
    await user.click(severityBtn);

    const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ sort: 'severity', dir: 'desc' });
  });

  it('shows column settings dropdown when gear button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindingsPage />);

    const gearBtn = screen.getByTitle('findings.columnSettings');
    await user.click(gearBtn);

    // Should show checkboxes for column settings (8 columns)
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(8);
    expect(screen.getByRole('checkbox', { name: 'findings.cvss' })).toBeInTheDocument();
  });

  it('hides a column when toggled off in settings', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindingsPage />);

    // Tool column should be visible by default
    const toolHeaders = screen.getAllByRole('button', { name: /findings\.tool/ });
    expect(toolHeaders.length).toBeGreaterThan(0);

    // Open settings and toggle tool off
    const gearBtn = screen.getByTitle('findings.columnSettings');
    await user.click(gearBtn);

    const toolCheckbox = screen.getByRole('checkbox', { name: 'findings.tool' });
    await user.click(toolCheckbox);

    // Tool column header should no longer be visible as a sortable button
    const remainingToolBtns = screen.queryAllByRole('button', { name: /findings\.tool/ });
    // The filter dropdown might still have "tool" text, but the table header button should be gone
    expect(remainingToolBtns.length).toBe(0);
  });

  it('shows duplicate count badge when finding has duplicates', () => {
    renderWithProviders(<FindingsPage />);
    // SQL Injection finding has duplicateCount=2 → "+2" badge
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('does not show badge for finding without duplicates', () => {
    renderWithProviders(<FindingsPage />);
    // XSS Vulnerability has no duplicateCount → no "+0" badge
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  it('passes the search term to the API (debounced) and resets the page', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindingsPage />);

    const searchInput = screen.getByPlaceholderText('findings.searchPlaceholder');
    await user.type(searchInput, 'sql');

    // Not sent immediately — debounced
    const callsBefore = mockUseFindings.mock.calls.filter((c) =>
      (c[0] as Record<string, unknown> | undefined)?.search === 'sql');
    expect(callsBefore.length).toBe(0);

    await waitFor(() => {
      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ search: 'sql', offset: 0 });
    });
  });

  it('does not filter results client-side while searching', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindingsPage />);

    const searchInput = screen.getByPlaceholderText('findings.searchPlaceholder');
    await user.type(searchInput, 'zzz-no-client-match');

    // Server results are rendered as-is; the old client-side filter would have
    // hidden both rows since neither title/filePath matches.
    expect(screen.getByText('SQL Injection')).toBeInTheDocument();
    expect(screen.getByText('XSS Vulnerability')).toBeInTheDocument();
  });

  it('keeps pagination rendered while a search term is active', async () => {
    mockUseFindings.mockReturnValue({
      data: {
        count: 60,
        results: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          title: `Finding ${i + 1}`,
          severity: 'Medium',
          status: 'open',
          filePath: null,
          line: null,
          tool: 'semgrep',
          cvssScore: null,
          testId: 1,
          createdAt: '2026-01-10T00:00:00Z',
        })),
      },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<FindingsPage />);

    const searchInput = screen.getByPlaceholderText('findings.searchPlaceholder');
    await user.type(searchInput, 'finding');

    await waitFor(() => {
      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ search: 'finding' });
    });
    expect(screen.getByText('common.first')).toBeInTheDocument();
    expect(screen.getByText('common.last')).toBeInTheDocument();
  });

  it('exports CSV through the shared API client (no raw fetch)', async () => {
    const user = userEvent.setup();
    // jsdom does not implement object URLs
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    renderWithProviders(<FindingsPage />);

    await user.click(screen.getByTitle('findings.exportCsv'));

    expect(mockFetchApiRaw).toHaveBeenCalledTimes(1);
    const url = mockFetchApiRaw.mock.calls[0][0] as string;
    expect(url).toContain('/api/findings/export.csv?');
    expect(url).toContain('workspace_id=1');

    // Blob download flow runs through the returned response
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:test'));
  });

  it('uses Pagination component instead of manual prev/next', () => {
    // With 2 results and PAGE_SIZE=50, no pagination shown
    mockUseFindings.mockReturnValueOnce({
      data: {
        count: 60,
        results: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          title: `Finding ${i + 1}`,
          severity: 'Medium',
          status: 'open',
          filePath: null,
          line: null,
          tool: 'semgrep',
          cvssScore: null,
          testId: 1,
          createdAt: '2026-01-10T00:00:00Z',
        })),
      },
      isLoading: false,
    });

    renderWithProviders(<FindingsPage />);

    // Pagination component renders "first" and "last" buttons
    expect(screen.getByText('common.first')).toBeInTheDocument();
    expect(screen.getByText('common.last')).toBeInTheDocument();
  });
});

describe('URL state sync', () => {
  const location = () => screen.getByTestId('location').textContent ?? '';

  const manyFindings = () => ({
    data: {
      count: 60,
      results: Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        title: `Finding ${i + 1}`,
        severity: 'Medium',
        status: 'open',
        filePath: null,
        line: null,
        tool: 'semgrep',
        cvssScore: null,
        testId: 1,
        createdAt: '2026-01-10T00:00:00Z',
      })),
    },
    isLoading: false,
  });

  describe('mount from URL restores state', () => {
    it('restores the severity filter from ?severity=', () => {
      renderWithProviders(<FindingsPage />, { initialEntries: ['/findings?severity=High,Critical'] });

      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ severity: 'High,Critical' });
    });

    it('restores the status filter from ?status= (API values)', () => {
      renderWithProviders(<FindingsPage />, { initialEntries: ['/findings?status=open,risk_accepted'] });

      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ status: 'open,risk_accepted' });
    });

    it('restores the duplicates toggle from ?dup=yes (no duplicate=false param)', () => {
      renderWithProviders(<FindingsPage />, { initialEntries: ['/findings?dup=yes'] });

      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).not.toHaveProperty('duplicate');
    });

    it('restores the committed search term from ?q= without a debounce round-trip', () => {
      renderWithProviders(<FindingsPage />, { initialEntries: ['/findings?q=sql'] });

      expect(screen.getByPlaceholderText('findings.searchPlaceholder')).toHaveValue('sql');
      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ search: 'sql', offset: 0 });
    });

    it('restores sort, direction and page from the URL', () => {
      mockUseFindings.mockImplementation(manyFindings);
      renderWithProviders(<FindingsPage />, { initialEntries: ['/findings?sort=severity&dir=desc&page=2'] });

      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ sort: 'severity', dir: 'desc', offset: 50 });
    });

    it('drops an invalid ?sort= value and cleans the URL', () => {
      renderWithProviders(<><FindingsPage /><LocationSpy /></>, { initialEntries: ['/findings?sort=bogus'] });

      expect(location()).toBe('/findings');
      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).not.toHaveProperty('sort');
    });
  });

  describe('state changes write the URL', () => {
    it('writes sort to ?sort= and toggles ?dir= on the second click', async () => {
      const user = userEvent.setup();
      renderWithProviders(<><FindingsPage /><LocationSpy /></>, { initialEntries: ['/findings'] });

      const severityBtn = screen.getByRole('button', { name: /findings\.severity/ });
      await user.click(severityBtn);
      expect(location()).toBe('/findings?sort=severity');

      await user.click(severityBtn);
      expect(location()).toBe('/findings?sort=severity&dir=desc');
    });

    it('writes the page to ?page= (1-based) and removes it back on page 1', async () => {
      mockUseFindings.mockImplementation(manyFindings);
      const user = userEvent.setup();
      renderWithProviders(<><FindingsPage /><LocationSpy /></>, { initialEntries: ['/findings'] });

      await user.click(screen.getByText('common.next'));
      expect(location()).toBe('/findings?page=2');

      await user.click(screen.getByText('common.previous'));
      expect(location()).toBe('/findings');
    });

    it('writes the debounced search term to ?q=', async () => {
      const user = userEvent.setup();
      renderWithProviders(<><FindingsPage /><LocationSpy /></>, { initialEntries: ['/findings'] });

      await user.type(screen.getByPlaceholderText('findings.searchPlaceholder'), 'sql');
      // Debounced — the URL updates once the term commits
      expect(location()).toBe('/findings');
      await waitFor(() => expect(location()).toBe('/findings?q=sql'));
    });

    it('removes ?status= when the status chip is removed (bidirectional)', async () => {
      const user = userEvent.setup();
      renderWithProviders(<><FindingsPage /><LocationSpy /></>, { initialEntries: ['/findings?status=open'] });

      expect(location()).toBe('/findings?status=open');
      await user.click(screen.getByTitle('common.remove'));
      expect(location()).toBe('/findings');
    });

    it('still writes ?repository= when a repository filter is picked (existing sync kept)', async () => {
      const user = userEvent.setup();
      renderWithProviders(<><FindingsPage /><LocationSpy /></>, { initialEntries: ['/findings'] });

      await user.click(screen.getByText(/common\.addFilter/));
      const columnItem = Array.from(document.querySelectorAll('.beast-filter-dropdown-item'))
        .find((el) => el.textContent === 'findings.repository');
      await user.click(columnItem as HTMLElement);
      const option = Array.from(document.querySelectorAll('.beast-filter-dropdown-item'))
        .find((el) => el.textContent?.includes('repo-1'));
      await user.click(option as HTMLElement);

      expect(location()).toBe('/findings?repository=1');
      const lastCall = mockUseFindings.mock.calls[mockUseFindings.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ repository_id: 1 });
    });
  });

  it('keeps the URL clean on a default view', () => {
    renderWithProviders(<><FindingsPage /><LocationSpy /></>, { initialEntries: ['/findings'] });

    expect(location()).toBe('/findings');
  });
});
