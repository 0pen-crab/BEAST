import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { FindingDetailPage } from './finding-detail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'findings.detail.description': 'Description',
        'findings.detail.location': 'Location',
        'findings.detail.notes': 'Notes',
        'findings.detail.properties': 'Properties',
        'findings.detail.setStatus': 'Set status:',
        'findings.detail.addNote': 'Add',
        'findings.detail.addNotePlaceholder': 'Add a note...',
        'findings.detail.noDescription': 'No description available',
        'findings.detail.noLocation': 'No file location',
        'findings.detail.noNotes': 'No notes yet',
        'findings.detail.notFound': 'Finding not found',
        'findings.detail.id': 'ID',
        'findings.detail.found': 'Found',
        'findings.detail.updated': 'Updated',
        'findings.detail.vulnId': 'Vuln ID',
        'findings.detail.scan': 'Scan',
        'findings.detail.repo': 'Repo',
        'findings.title': 'Findings',
        'findings.severity': 'Severity',
        'findings.status': 'Status',
        'findings.tool': 'Tool',
        'findings.cvss': 'CVSS',
        'findings.contributor': 'Contributor',
        'findings.repository': 'Repository',
        'status.Open': 'Open',
        'status.FalsePositive': 'False Positive',
        'status.Fixed': 'Fixed',
        'status.Accepted': 'Risk Accepted',
        'status.Duplicate': 'Duplicate',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useParams: vi.fn(() => ({ id: '42' })),
  };
});

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

const mockFinding = {
  id: 42,
  title: 'Hardcoded Secret in Config',
  severity: 'Critical' as const,
  description: 'A hardcoded secret was found.',
  status: 'open',
  riskAcceptedReason: null,
  duplicateOf: null,
  filePath: 'config/settings.ts',
  line: 10,
  cwe: 798,
  cvssScore: 9.1,
  tool: 'gitleaks',
  testId: 1,
  repositoryId: 5,
  vulnIdFromTool: 'GL-001',
  fingerprint: null,
  createdAt: '2026-01-05T00:00:00Z',
  updatedAt: '2026-01-05T00:00:00Z',
  contributorId: 7,
  contributorName: 'Dev User',
  repositoryName: 'my-repo',
  scanId: 'scan-abc-123',
};

vi.mock('@/api/hooks', () => ({
  useFinding: vi.fn(() => ({
    data: mockFinding,
    isLoading: false,
  })),
  useFindingNotes: vi.fn(() => ({
    data: [
      { id: 1, findingId: 42, author: 'admin', noteType: 'comment', content: 'Test note', createdAt: '2026-01-05T12:00:00Z' },
    ],
    isLoading: false,
  })),
  useUpdateFinding: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useAddFindingNote: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

describe('FindingDetailPage', () => {
  // --- Header ---
  it('renders finding title', () => {
    renderWithProviders(<FindingDetailPage />);
    expect(screen.getByText('Hardcoded Secret in Config')).toBeInTheDocument();
  });

  it('renders severity and status badges', () => {
    renderWithProviders(<FindingDetailPage />);
    // Severity appears in both header badges and properties sidebar
    const criticals = screen.getAllByText('Critical');
    expect(criticals.length).toBeGreaterThanOrEqual(1);
  });

  it('renders CWE badge with link to mitre.org', () => {
    renderWithProviders(<FindingDetailPage />);
    // CWE appears in both header badge and properties sidebar
    const cweLinks = screen.getAllByText('CWE-798');
    const linkedCwe = cweLinks.find((el) => el.closest('a'));
    expect(linkedCwe?.closest('a')).toHaveAttribute('href', 'https://cwe.mitre.org/data/definitions/798.html');
  });

  it('renders CVSS badge', () => {
    renderWithProviders(<FindingDetailPage />);
    // CVSS appears in both header badge and properties
    const cvssElements = screen.getAllByText(/9\.1/);
    expect(cvssElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders status action buttons after opening dropdown', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FindingDetailPage />);
    const statusBtn = screen.getByRole('button', { name: /open/i });
    await user.click(statusBtn);
    expect(screen.getByRole('button', { name: /false positive/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fixed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accepted/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
  });

  // --- Meta row ---
  it('renders repository link in meta row', () => {
    renderWithProviders(<FindingDetailPage />);
    const repoLinks = screen.getAllByText('my-repo');
    const link = repoLinks.find((el) => el.closest('a'));
    expect(link?.closest('a')).toHaveAttribute('href', '/repos/5');
  });

  it('renders contributor link in meta row', () => {
    renderWithProviders(<FindingDetailPage />);
    const links = screen.getAllByText('Dev User');
    const link = links.find((el) => el.closest('a'));
    expect(link?.closest('a')).toHaveAttribute('href', '/contributors/7');
  });

  // --- Content sections ---
  it('shows description', () => {
    renderWithProviders(<FindingDetailPage />);
    expect(screen.getByText('A hardcoded secret was found.')).toBeInTheDocument();
  });

  it('shows file path in location section', () => {
    renderWithProviders(<FindingDetailPage />);
    expect(screen.getByText('config/settings.ts:10')).toBeInTheDocument();
  });

  it('shows notes', () => {
    renderWithProviders(<FindingDetailPage />);
    expect(screen.getByText('Test note')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
  });

  it('calls addNote.mutate when submitting a note', async () => {
    const hooks = await import('@/api/hooks');
    const mockMutate = vi.fn();
    (hooks.useAddFindingNote as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<FindingDetailPage />);
    const input = screen.getByPlaceholderText(/add a note/i);
    await user.type(input, 'New note text');
    await user.click(screen.getByRole('button', { name: /^Add$/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ findingId: 42, entry: 'New note text' }),
      expect.anything(),
    );
  });

  // --- Properties sidebar ---
  it('renders tool name in properties', () => {
    renderWithProviders(<FindingDetailPage />);
    // Tool appears in both header badge and properties sidebar
    const toolElements = screen.getAllByText('gitleaks');
    expect(toolElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders vuln ID in properties', () => {
    renderWithProviders(<FindingDetailPage />);
    expect(screen.getByText('GL-001')).toBeInTheDocument();
  });

  // --- Null/missing data ---
  it('hides context bar repo when repositoryName is null', async () => {
    const hooks = await import('@/api/hooks');
    (hooks.useFinding as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockFinding, repositoryId: null, repositoryName: null },
      isLoading: false,
    });
    renderWithProviders(<FindingDetailPage />);
    expect(screen.queryByText('my-repo')).not.toBeInTheDocument();
  });

  it('hides contributor when contributorId is null', async () => {
    const hooks = await import('@/api/hooks');
    (hooks.useFinding as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockFinding, contributorId: null, contributorName: null },
      isLoading: false,
    });
    renderWithProviders(<FindingDetailPage />);
    expect(screen.queryByText('Dev User')).not.toBeInTheDocument();
  });

  it('shows empty state when finding is null', async () => {
    const hooks = await import('@/api/hooks');
    (hooks.useFinding as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
    });
    renderWithProviders(<FindingDetailPage />);
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });
});
