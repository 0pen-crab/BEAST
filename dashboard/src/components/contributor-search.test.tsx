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

  it('ignores a stale response that resolves after a newer request', async () => {
    let resolveStale!: (value: unknown) => void;
    const stale = new Promise((r) => { resolveStale = r; });
    fetchMock
      .mockImplementationOnce(() => stale) // first (slow) request
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          count: 1,
          results: [{ id: 2, displayName: 'Fresh', emails: ['fresh@test.com'] }],
        }),
      });

    render(<ContributorSearch workspaceId={1} excludeIds={[]} onSelect={mockOnSelect} />);
    const input = screen.getByPlaceholderText('Search by name or email...');
    fireEvent.change(input, { target: { value: 'old query' } });
    // Let the debounce fire so the slow request is actually dispatched
    await new Promise((r) => setTimeout(r, 350));
    fireEvent.change(input, { target: { value: 'fresh query' } });

    await waitFor(() => expect(screen.getByText('Fresh')).toBeDefined());

    // The stale (earlier) response arrives late — it must NOT overwrite fresh results
    resolveStale({
      ok: true,
      json: async () => ({
        count: 1,
        results: [{ id: 1, displayName: 'Stale', emails: ['stale@test.com'] }],
      }),
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByText('Fresh')).toBeDefined();
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
