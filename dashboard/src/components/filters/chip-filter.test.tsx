import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChipFilter, type FilterColumn } from './chip-filter';

// Mirror the project-wide test convention: t() returns the key/fallback.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const toolColumn: FilterColumn = {
  key: 'tool',
  label: 'Tool',
  multi: true,
  options: [
    { value: 'semgrep', label: 'Semgrep', group: 'Code Analysis' },
    { value: 'claude', label: 'Claude', group: 'Code Analysis' },
    { value: 'gitleaks', label: 'Gitleaks', group: 'Secrets' },
  ],
};

const flatColumn: FilterColumn = {
  key: 'status',
  label: 'Status',
  multi: true,
  options: [
    { value: 'active', label: 'Active' },
    { value: 'mitigated', label: 'Mitigated' },
  ],
};

function open(column: FilterColumn) {
  const onAdd = vi.fn();
  render(<ChipFilter columns={[column]} activeFilters={[]} onAdd={onAdd} onRemove={vi.fn()} />);
  fireEvent.click(screen.getByText(/Add filter/));
  fireEvent.click(screen.getByRole('button', { name: column.label }));
  return onAdd;
}

describe('ChipFilter grouped multi-select', () => {
  it('renders category headers and their tools when options carry a group', () => {
    open(toolColumn);
    expect(screen.getByRole('checkbox', { name: 'Code Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Secrets' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Semgrep' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Gitleaks' })).toBeInTheDocument();
  });

  it('selecting a category checkbox selects every tool in that category', () => {
    const onAdd = open(toolColumn);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Code Analysis' }));

    expect((screen.getByRole('checkbox', { name: 'Semgrep' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Claude' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Gitleaks' }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByText(/Apply/));
    expect(onAdd).toHaveBeenCalledWith('tool', 'semgrep,claude');
  });

  it('clicking a fully-selected category checkbox clears it', () => {
    open(toolColumn);
    const catBox = screen.getByRole('checkbox', { name: 'Code Analysis' });
    fireEvent.click(catBox); // select all
    fireEvent.click(catBox); // clear all
    expect((screen.getByRole('checkbox', { name: 'Semgrep' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Claude' }) as HTMLInputElement).checked).toBe(false);
  });

  it('category checkbox is indeterminate when only some tools are selected', () => {
    open(toolColumn);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Semgrep' }));
    const catBox = screen.getByRole('checkbox', { name: 'Code Analysis' }) as HTMLInputElement;
    expect(catBox.indeterminate).toBe(true);
    expect(catBox.checked).toBe(false);
  });

  it('renders a flat list (no category headers) when options have no group', () => {
    open(flatColumn);
    expect(screen.queryByRole('checkbox', { name: 'Code Analysis' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mitigated' })).toBeInTheDocument();
  });
});

const repoColumn: FilterColumn = {
  key: 'repository',
  label: 'Repository',
  searchable: true,
  options: [
    { value: '1', label: 'shop' },
    { value: '2', label: 'matrix' },
    { value: '3', label: 'matrixweb' },
    { value: '4', label: 'devices' },
  ],
};

describe('ChipFilter searchable single-select', () => {
  it('shows a search box and all options when searchable', () => {
    open(repoColumn);
    expect(screen.getByPlaceholderText(/Search/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'devices' })).toBeInTheDocument();
  });

  it('filters options dynamically as the user types', () => {
    open(repoColumn);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'matrix' } });

    expect(screen.getByRole('button', { name: 'matrix' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'matrixweb' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'devices' })).not.toBeInTheDocument();
  });

  it('matches case-insensitively', () => {
    open(repoColumn);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'SHOP' } });
    expect(screen.getByRole('button', { name: 'shop' })).toBeInTheDocument();
  });

  it('shows a no-matches message when nothing matches', () => {
    open(repoColumn);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('picks a value and calls onAdd', () => {
    const onAdd = open(repoColumn);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'web' } });
    fireEvent.click(screen.getByRole('button', { name: 'matrixweb' }));
    expect(onAdd).toHaveBeenCalledWith('repository', '3');
  });

  it('does not show a search box for non-searchable single-selects', () => {
    open({ key: 'src', label: 'Source', options: [{ value: 'a', label: 'A' }] });
    expect(screen.queryByPlaceholderText(/Search/)).not.toBeInTheDocument();
  });
});

describe('ChipFilter dropdown toggling', () => {
  it('clicking "+ Add filter" a second time closes the column picker', () => {
    render(<ChipFilter columns={[toolColumn]} activeFilters={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    const addBtn = screen.getByText(/Add filter/);
    fireEvent.click(addBtn);
    expect(screen.getByText('Filter by column')).toBeInTheDocument();
    fireEvent.click(addBtn);
    expect(screen.queryByText('Filter by column')).not.toBeInTheDocument();
  });

  it('closes open dropdowns on Escape', () => {
    render(<ChipFilter columns={[toolColumn]} activeFilters={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByText(/Add filter/));
    expect(screen.getByText('Filter by column')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Filter by column')).not.toBeInTheDocument();
  });

  it('closes the value picker on Escape', () => {
    open(toolColumn);
    expect(screen.getByRole('checkbox', { name: 'Semgrep' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('checkbox', { name: 'Semgrep' })).not.toBeInTheDocument();
  });
});

describe('ChipFilter range picker', () => {
  const rangeColumn: FilterColumn = {
    key: 'cvss',
    label: 'CVSS',
    type: 'range',
    options: [],
  };

  it('renders numeric inputs with i18n Min/Max placeholders', () => {
    open(rangeColumn);
    const min = screen.getByPlaceholderText('Min') as HTMLInputElement;
    const max = screen.getByPlaceholderText('Max') as HTMLInputElement;
    expect(min.type).toBe('number');
    expect(max.type).toBe('number');
  });

  it('applies the range as min..max', () => {
    const onAdd = open(rangeColumn);
    fireEvent.change(screen.getByPlaceholderText('Min'), { target: { value: '4' } });
    fireEvent.change(screen.getByPlaceholderText('Max'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(onAdd).toHaveBeenCalledWith('cvss', '4..9');
  });
});

describe('ChipFilter multi-select search', () => {
  // 10 options (> threshold) → search box appears automatically, even without a flag
  const manyToolsColumn: FilterColumn = {
    key: 'tool',
    label: 'Tool',
    multi: true,
    options: Array.from({ length: 10 }, (_, i) => ({ value: `t${i}`, label: i === 3 ? 'gitleaks' : `tool-${i}` })),
  };

  it('auto-shows a search box for long multi-selects and filters the checkboxes', () => {
    open(manyToolsColumn);
    expect(screen.getByPlaceholderText(/Search/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'gitleaks' } });
    expect(screen.getByRole('checkbox', { name: 'gitleaks' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'tool-0' })).not.toBeInTheDocument();
  });

  it('shows no-matches in a multi-select when nothing matches', () => {
    open(manyToolsColumn);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });
});
