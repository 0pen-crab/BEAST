import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MergeContributorModal } from './merge-contributor-modal.tsx';
import type { Contributor } from '../api/contributor-types.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'contributors.mergeTitle': 'Merge Contributor',
        'contributors.mergeBulkTitle': `Merge ${opts?.count ?? ''} Contributors`,
        'contributors.mergeConfirm': 'Confirm Merge',
        'contributors.mergePickTarget': 'Select which contributor to keep',
        'contributors.mergeWarning': `${opts?.name ?? ''} will be permanently deleted`,
        'contributors.mergeTransfers': 'All data will transfer',
        'contributors.mergeSourceLabel': 'Will be merged and deleted',
        'contributors.mergeTargetLabel': 'Will keep all merged data',
        'contributors.mergeSearchPlaceholder': 'Search by name or email...',
        'common.cancel': 'Cancel',
        'common.saving': 'Saving...',
      };
      return map[key] ?? key;
    },
  }),
}));

const alice: Contributor = {
  id: 1, displayName: 'Alice', emails: ['a@test.com'],
  totalCommits: 100, repoCount: 3, totalLocAdded: 0, totalLocRemoved: 0,
  scoreOverall: null, scoreSecurity: null, scoreQuality: null,
  scorePatterns: null, scoreTesting: null, scoreInnovation: null,
  firstSeen: null, lastSeen: '2026-03-01', feedback: null,
  createdAt: '', updatedAt: '',
};

const bob: Contributor = {
  ...alice, id: 2, displayName: 'Bob', emails: ['b@test.com'],
  totalCommits: 50, lastSeen: '2026-03-15',
};

describe('MergeContributorModal', () => {
  const mockOnConfirm = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('renders single mode — shows source info and search', () => {
    render(
      <MergeContributorModal
        mode="single"
        source={alice}
        workspaceId={1}
        onConfirm={mockOnConfirm}
        onClose={mockOnClose}
      />,
    );
    expect(screen.getByText('Merge Contributor')).toBeDefined();
    expect(screen.getByText(/Alice/)).toBeDefined();
    expect(screen.getByText('Will be merged and deleted')).toBeDefined();
  });

  it('renders bulk mode — shows radio buttons for target selection', () => {
    render(
      <MergeContributorModal
        mode="bulk"
        candidates={[alice, bob]}
        workspaceId={1}
        onConfirm={mockOnConfirm}
        onClose={mockOnClose}
      />,
    );
    expect(screen.getByText('Merge 2 Contributors')).toBeDefined();
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(2);
  });

  it('bulk mode — pre-selects most recently active contributor as target', () => {
    render(
      <MergeContributorModal
        mode="bulk"
        candidates={[alice, bob]}
        workspaceId={1}
        onConfirm={mockOnConfirm}
        onClose={mockOnClose}
      />,
    );
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    // Bob has lastSeen 2026-03-15 (more recent than Alice's 2026-03-01)
    const bobRadio = radios.find((r) => r.value === '2');
    expect(bobRadio?.checked).toBe(true);
  });

  it('calls onClose when cancel clicked', () => {
    render(
      <MergeContributorModal
        mode="single"
        source={alice}
        workspaceId={1}
        onConfirm={mockOnConfirm}
        onClose={mockOnClose}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows error message when error prop is set', () => {
    render(
      <MergeContributorModal
        mode="single"
        source={alice}
        workspaceId={1}
        onConfirm={mockOnConfirm}
        onClose={mockOnClose}
        error="Merge failed: server error"
      />,
    );
    expect(screen.getByText('Merge failed: server error')).toBeDefined();
  });
});
