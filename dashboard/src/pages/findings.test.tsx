import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { FindingsPage } from './findings';

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

const mockUseFindings = vi.fn(() => ({
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
}));

vi.mock('@/api/hooks', () => ({
  useFindings: (...args: unknown[]) => mockUseFindings(...args),
  useRepositories: vi.fn(() => ({
    data: [{ id: 1, name: 'repo-1' }],
    isLoading: false,
  })),
}));

beforeEach(() => {
  localStorage.clear();
  mockUseFindings.mockClear();
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
