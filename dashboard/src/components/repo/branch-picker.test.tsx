import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';

// Project-wide convention: t() returns the key. Interpolate `count` so the
// commit-count assertion still proves the number reaches the label.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) =>
      opts && typeof opts === 'object' && 'count' in opts
        ? `${key}:${(opts as { count: number }).count}`
        : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const mockUseRepositoryBranches = vi.fn();
const mockMutate = vi.fn();
const mockUseUpdateRepository = vi.fn(() => ({ mutate: mockMutate, isPending: false }));

vi.mock('@/api/hooks', () => ({
  useRepositoryBranches: (...a: unknown[]) => mockUseRepositoryBranches(...a),
  useUpdateRepository: () => mockUseUpdateRepository(),
}));

import { BranchPicker } from './branch-picker';

const DAY = 86_400_000;

/** [branch, days since last commit] */
function branches(list: Array<[string, number]>) {
  return {
    data: list.map(([name, daysAgo]) => ({
      name,
      lastCommitAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
    })),
    isLoading: false,
    isError: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUpdateRepository.mockReturnValue({ mutate: mockMutate, isPending: false });
  // Server returns them freshest-first; the picker preserves that order.
  mockUseRepositoryBranches.mockReturnValue(branches([['develop', 1], ['main', 30]]));
});

describe('BranchPicker', () => {
  it('lists branches in the order the API returned them, freshest first', () => {
    renderWithProviders(<BranchPicker repositoryId={7} value="develop" />);

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    // First entry is the "follow the remote" escape hatch, then the branches.
    expect(options[1]).toContain('develop');
    expect(options[2]).toContain('main');
  });

  it('shows how recently each branch was touched', () => {
    // A number of commits told you nothing; "1 day ago" vs "30 days ago" tells
    // you which branch is alive.
    renderWithProviders(<BranchPicker repositoryId={7} value="develop" />);

    expect(screen.getAllByRole('option')[1].textContent).toContain('branchDaysAgo:1');
    expect(screen.getAllByRole('option')[2].textContent).toContain('branchDaysAgo:30');
  });

  it('selects the saved branch', () => {
    renderWithProviders(<BranchPicker repositoryId={7} value="develop" />);

    expect(screen.getByRole('combobox')).toHaveValue('develop');
  });

  it('saves the picked branch', async () => {
    renderWithProviders(<BranchPicker repositoryId={7} value="main" />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'develop' } });

    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, default_branch: 'develop' }),
      ),
    );
  });

  it('does not save when the value did not change', () => {
    renderWithProviders(<BranchPicker repositoryId={7} value="develop" />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'develop' } });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('keeps a saved branch selectable even when the clone no longer lists it', () => {
    // Branch deleted upstream, or the clone predates it. Dropping it would make
    // the picker show a different branch from the one scans actually use.
    mockUseRepositoryBranches.mockReturnValue(branches([['main', 12]]));

    renderWithProviders(<BranchPicker repositoryId={7} value="gone-branch" />);

    expect(screen.getByRole('combobox')).toHaveValue('gone-branch');
  });

  it('explains an empty list instead of showing a bare dropdown', () => {
    mockUseRepositoryBranches.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderWithProviders(<BranchPicker repositoryId={7} value={null} />);

    expect(screen.getByTestId('branch-picker').textContent).toContain('branchNeedsScan');
  });

  it('falls back to plain text when the branch list cannot be read', () => {
    // A failed lookup must not look like "this repo has one branch".
    mockUseRepositoryBranches.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderWithProviders(<BranchPicker repositoryId={7} value="develop" />);

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('branch-picker-error').textContent).toContain('develop');
  });

  it('is read-only without edit rights', () => {
    renderWithProviders(<BranchPicker repositoryId={7} value="develop" canEdit={false} />);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
