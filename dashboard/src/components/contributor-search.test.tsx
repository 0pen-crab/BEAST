import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContributorSearch } from './contributor-search.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'contributors.mergeSearchPlaceholder': 'Search by name or email...',
      };
      return map[key] ?? key;
    },
  }),
}));

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe('ContributorSearch', () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input with placeholder', () => {
    render(<ContributorSearch workspaceId={1} excludeIds={[]} onSelect={mockOnSelect} />);
    expect(screen.getByPlaceholderText('Search by name or email...')).toBeDefined();
  });

  it('calls onSelect when a result is clicked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 1,
        results: [{ id: 5, displayName: 'Alice', emails: ['alice@test.com'] }],
      }),
    });

    render(<ContributorSearch workspaceId={1} excludeIds={[]} onSelect={mockOnSelect} />);
    const input = screen.getByPlaceholderText('Search by name or email...');
    fireEvent.change(input, { target: { value: 'alice' } });

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Alice'));
    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, displayName: 'Alice' }),
    );
  });

  it('excludes specified contributor IDs from results', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 2,
        results: [
          { id: 5, displayName: 'Alice', emails: ['alice@test.com'] },
          { id: 10, displayName: 'Bob', emails: ['bob@test.com'] },
        ],
      }),
    });

    render(<ContributorSearch workspaceId={1} excludeIds={[5]} onSelect={mockOnSelect} />);
    const input = screen.getByPlaceholderText('Search by name or email...');
    fireEvent.change(input, { target: { value: 'al' } });

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeDefined();
    });

    expect(screen.queryByText('Alice')).toBeNull();
  });
});
