import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { RepoPicker } from './repo-picker';

vi.mock('@/api/hooks', () => ({
  useImportFromSource: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

describe('RepoPicker selectionMode', () => {
  const repos = [
    { slug: 'repo-a', fullName: 'org/repo-a', cloneUrl: '', description: null, imported: false },
    { slug: 'repo-b', fullName: 'org/repo-b', cloneUrl: '', description: null, imported: false },
  ];

  it('uses external selected set in selectionMode', () => {
    const selected = new Set(['repo-a']);
    renderWithProviders(
      <RepoPicker
        repos={repos} sourceId={1} onImported={vi.fn()}
        selectionMode selected={selected} onSelectionChange={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('hides import buttons in selectionMode', () => {
    renderWithProviders(
      <RepoPicker
        repos={repos} sourceId={1} onImported={vi.fn()}
        selectionMode selected={new Set()} onSelectionChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/import all/i)).not.toBeInTheDocument();
  });

  it('shows the last-updated date when lastActivityAt is present', () => {
    const withDate = [
      { slug: 'repo-a', fullName: 'org/repo-a', cloneUrl: '', description: null, imported: false, lastActivityAt: '2026-03-15T10:00:00Z' },
      { slug: 'repo-b', fullName: 'org/repo-b', cloneUrl: '', description: null, imported: false, lastActivityAt: null },
    ];
    renderWithProviders(
      <RepoPicker
        repos={withDate as any} sourceId={1} onImported={vi.fn()}
        selectionMode selected={new Set()} onSelectionChange={vi.fn()}
      />,
    );
    // repo-a renders the app-standard DD.MM.YYYY date; repo-b (null) renders nothing
    expect(screen.getByText(/15\.03\.2026/)).toBeInTheDocument();
  });
});
