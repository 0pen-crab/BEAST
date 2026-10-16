import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserSearch } from './user-search.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'members.searchUserPlaceholder': 'Search users by name or email...',
        'members.noMatchingUsers': 'No matching users',
      };
      return map[key] ?? key;
    },
  }),
}));

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

function mockUsers(users: Array<{ id: number; username: string; displayName: string | null }>) {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => users });
}

describe('UserSearch', () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input with placeholder', () => {
    render(<UserSearch workspaceId={1} onSelect={mockOnSelect} />);
    expect(screen.getByPlaceholderText('Search users by name or email...')).toBeDefined();
  });

  it('loads candidate users on focus (empty query)', async () => {
    mockUsers([
      { id: 5, username: 'alice@corp.com', displayName: 'Alice' },
      { id: 6, username: 'bob@corp.com', displayName: 'Bob' },
    ]);

    render(<UserSearch workspaceId={1} onSelect={mockOnSelect} />);
    fireEvent.focus(screen.getByPlaceholderText('Search users by name or email...'));

    // The list shows plain emails (usernames), not display names.
    await waitFor(() => {
      expect(screen.getByText('alice@corp.com')).toBeDefined();
      expect(screen.getByText('bob@corp.com')).toBeDefined();
    });
  });

  it('calls onSelect with the chosen user when a result is clicked', async () => {
    mockUsers([{ id: 5, username: 'alice@corp.com', displayName: 'Alice' }]);

    render(<UserSearch workspaceId={1} onSelect={mockOnSelect} />);
    const input = screen.getByPlaceholderText('Search users by name or email...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'alice' } });

    await waitFor(() => expect(screen.getByText('alice@corp.com')).toBeDefined());

    fireEvent.click(screen.getByText('alice@corp.com'));
    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, username: 'alice@corp.com', displayName: 'Alice' }),
    );
  });

  it('requests the workspace-scoped search endpoint with the typed query', async () => {
    mockUsers([]);

    render(<UserSearch workspaceId={42} onSelect={mockOnSelect} />);
    const input = screen.getByPlaceholderText('Search users by name or email...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'carol' } });

    await waitFor(() => {
      const calledUrl = String(fetchMock.mock.calls.at(-1)?.[0] ?? '');
      expect(calledUrl).toContain('/api/workspaces/42/users/search');
      expect(calledUrl).toContain('q=carol');
    });
  });

  it('keeps the dropdown open with a message when there are no matching users', async () => {
    mockUsers([]);

    render(<UserSearch workspaceId={1} onSelect={mockOnSelect} />);
    fireEvent.focus(screen.getByPlaceholderText('Search users by name or email...'));

    await waitFor(() => {
      expect(screen.getByText('No matching users')).toBeDefined();
    });
  });

  it('ignores a stale response that resolves after a newer request', async () => {
    let resolveStale!: (value: unknown) => void;
    const stale = new Promise((r) => { resolveStale = r; });
    fetchMock
      .mockImplementationOnce(() => stale) // first (slow) request
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 2, username: 'fresh@corp.com', displayName: 'Fresh' }],
      });

    render(<UserSearch workspaceId={1} onSelect={mockOnSelect} />);
    const input = screen.getByPlaceholderText('Search users by name or email...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'old' } });
    // Let the debounce fire so the slow request is actually dispatched
    await new Promise((r) => setTimeout(r, 350));
    fireEvent.change(input, { target: { value: 'fresh' } });

    await waitFor(() => expect(screen.getByText('fresh@corp.com')).toBeDefined());

    // Now the stale (earlier) response arrives — it must NOT overwrite fresh results
    resolveStale({ ok: true, json: async () => [{ id: 1, username: 'stale@corp.com', displayName: 'Stale' }] });
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText('stale@corp.com')).toBeNull();
    expect(screen.getByText('fresh@corp.com')).toBeDefined();
  });

  it('falls back to the email when displayName is null', async () => {
    mockUsers([{ id: 9, username: 'nodisplay@corp.com', displayName: null }]);

    render(<UserSearch workspaceId={1} onSelect={mockOnSelect} />);
    fireEvent.focus(screen.getByPlaceholderText('Search users by name or email...'));

    await waitFor(() => {
      const el = document.querySelector('.beast-typeahead-name');
      expect(el?.textContent).toBe('nodisplay@corp.com');
    });
  });
});
