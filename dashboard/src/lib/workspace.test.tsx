import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WorkspaceProvider, useWorkspace, type Workspace } from './workspace';

// Mock useAuth from ./auth
const mockUseAuth = vi.fn(() => ({ isAuthenticated: true }));
vi.mock('./auth', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

// Stub global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---- helpers ----

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 1,
    name: 'Default',
    description: null,
    defaultLanguage: 'en',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function okResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(queryClient?: QueryClient) {
  const qc = queryClient ?? createQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </QueryClientProvider>
    );
  };
}

// ---- setup ----

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockUseAuth.mockReturnValue({ isAuthenticated: true });
});

// ---- tests ----

describe('WorkspaceProvider + useWorkspace', () => {
  // 1. Fetches workspaces when authenticated
  describe('fetches workspaces', () => {
    it('calls /api/workspaces when authenticated', async () => {
      const ws = [makeWorkspace()];
      mockFetch.mockReturnValue(okResponse(ws));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/workspaces', {
        headers: expect.any(Headers),
      });
      expect(result.current.workspaces).toEqual(ws);
    });

    it('does not fetch when not authenticated', async () => {
      mockUseAuth.mockReturnValue({ isAuthenticated: false });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      // isLoading should be false because isAuthenticated && isLoading => false && true = false
      expect(result.current.isLoading).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.current.workspaces).toEqual([]);
    });
  });

  // 2. Auto-selects first workspace when none selected
  describe('auto-selects first workspace', () => {
    it('selects first workspace when selectedId is null', async () => {
      const ws = [
        makeWorkspace({ id: 10, name: 'First' }),
        makeWorkspace({ id: 20, name: 'Second' }),
      ];
      mockFetch.mockReturnValue(okResponse(ws));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.currentWorkspace).not.toBeNull();
      });

      expect(result.current.currentWorkspace!.id).toBe(10);
      expect(localStorage.getItem('beast_workspace_id')).toBe('10');
    });
  });

  // 3. Restores from localStorage
  describe('restores from localStorage', () => {
    it('reads stored workspace_id and selects it', async () => {
      localStorage.setItem('beast_workspace_id', '20');

      const ws = [
        makeWorkspace({ id: 10, name: 'First' }),
        makeWorkspace({ id: 20, name: 'Second' }),
      ];
      mockFetch.mockReturnValue(okResponse(ws));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.currentWorkspace).not.toBeNull();
      });

      expect(result.current.currentWorkspace!.id).toBe(20);
      expect(result.current.currentWorkspace!.name).toBe('Second');
    });
  });

  // 4. Resets to first if selected workspace no longer exists
  describe('resets to first if selected workspace no longer exists', () => {
    it('falls back to first workspace when stored id is gone', async () => {
      localStorage.setItem('beast_workspace_id', '999');

      const ws = [
        makeWorkspace({ id: 10, name: 'First' }),
        makeWorkspace({ id: 20, name: 'Second' }),
      ];
      mockFetch.mockReturnValue(okResponse(ws));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.currentWorkspace).not.toBeNull();
      });

      expect(result.current.currentWorkspace!.id).toBe(10);
      expect(localStorage.getItem('beast_workspace_id')).toBe('10');
    });

    it('clears selection and localStorage when all workspaces are deleted', async () => {
      localStorage.setItem('beast_workspace_id', '10');

      const ws = [makeWorkspace({ id: 10, name: 'Only' })];
      mockFetch.mockReturnValueOnce(okResponse(ws));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.currentWorkspace).not.toBeNull();
      });

      expect(result.current.currentWorkspace!.id).toBe(10);

      // Simulate deletion: refetch returns empty list
      mockFetch.mockReturnValueOnce(okResponse([]));

      await act(async () => {
        result.current.refetchWorkspaces();
      });

      await waitFor(() => {
        expect(result.current.workspaces).toHaveLength(0);
      });

      expect(result.current.currentWorkspace).toBeNull();
      expect(result.current.needsOnboarding).toBe(true);
      expect(localStorage.getItem('beast_workspace_id')).toBeNull();
    });
  });

  // 5. switchWorkspace
  describe('switchWorkspace', () => {
    it('updates selection and saves to localStorage', async () => {
      const ws = [
        makeWorkspace({ id: 10, name: 'First' }),
        makeWorkspace({ id: 20, name: 'Second' }),
      ];
      mockFetch.mockReturnValue(okResponse(ws));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.currentWorkspace).not.toBeNull();
      });

      // Initially selects first
      expect(result.current.currentWorkspace!.id).toBe(10);

      act(() => {
        result.current.switchWorkspace(20);
      });

      expect(result.current.currentWorkspace!.id).toBe(20);
      expect(localStorage.getItem('beast_workspace_id')).toBe('20');
    });

    it('clears query cache but keeps workspaces cache', async () => {
      const ws = [
        makeWorkspace({ id: 10, name: 'First' }),
        makeWorkspace({ id: 20, name: 'Second' }),
      ];
      mockFetch.mockReturnValue(okResponse(ws));

      const qc = createQueryClient();
      const removeQueriesSpy = vi.spyOn(qc, 'removeQueries');

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(qc),
      });

      await waitFor(() => {
        expect(result.current.currentWorkspace).not.toBeNull();
      });

      act(() => {
        result.current.switchWorkspace(20);
      });

      // removeQueries should have been called with a predicate
      expect(removeQueriesSpy).toHaveBeenCalledTimes(1);
      const call = removeQueriesSpy.mock.calls[0][0] as { predicate: (query: { queryKey: unknown[] }) => boolean };
      expect(call.predicate).toBeDefined();

      // The predicate should return false for 'workspaces' (keeping it)
      expect(call.predicate({ queryKey: ['workspaces'] })).toBe(false);

      // The predicate should return true for non-workspaces queries (removing them)
      expect(call.predicate({ queryKey: ['teams', 10] })).toBe(true);
      expect(call.predicate({ queryKey: ['findings', 10] })).toBe(true);
      expect(call.predicate({ queryKey: ['repositories'] })).toBe(true);

      removeQueriesSpy.mockRestore();
    });
  });

  // 6. needsOnboarding
  describe('needsOnboarding', () => {
    it('is true when authenticated, not loading, and no workspaces', async () => {
      mockFetch.mockReturnValue(okResponse([]));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.needsOnboarding).toBe(true);
    });

    it('is false when workspaces exist', async () => {
      mockFetch.mockReturnValue(okResponse([makeWorkspace()]));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.needsOnboarding).toBe(false);
    });

    it('is false when not authenticated', async () => {
      mockUseAuth.mockReturnValue({ isAuthenticated: false });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      // Not authenticated: needsOnboarding is false (isAuthenticated && !isLoading && length===0 => false)
      expect(result.current.needsOnboarding).toBe(false);
    });
  });

  // 7. useWorkspace outside provider throws
  describe('useWorkspace outside provider', () => {
    it('throws an error when used outside WorkspaceProvider', () => {
      // Suppress React error boundary console noise
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useWorkspace());
      }).toThrow('useWorkspace must be used within WorkspaceProvider');

      spy.mockRestore();
    });
  });

  // Additional edge cases
  describe('isLoading reflects auth state', () => {
    it('is false when not authenticated even if query would be loading', () => {
      mockUseAuth.mockReturnValue({ isAuthenticated: false });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      // isLoading = isAuthenticated && isLoading = false && anything = false
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('currentWorkspace', () => {
    it('is null when workspaces list is empty', async () => {
      mockFetch.mockReturnValue(okResponse([]));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.currentWorkspace).toBeNull();
    });

    it('is null when selectedId does not match any workspace and list is empty', async () => {
      localStorage.setItem('beast_workspace_id', '999');
      mockFetch.mockReturnValue(okResponse([]));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.currentWorkspace).toBeNull();
    });
  });

  describe('refetchWorkspaces', () => {
    it('exposes refetch function', async () => {
      mockFetch.mockReturnValue(okResponse([makeWorkspace()]));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(typeof result.current.refetchWorkspaces).toBe('function');
    });

    it('re-fetches workspaces when called', async () => {
      const ws1 = [makeWorkspace({ id: 1, name: 'Original' })];
      const ws2 = [
        makeWorkspace({ id: 1, name: 'Original' }),
        makeWorkspace({ id: 2, name: 'New' }),
      ];
      mockFetch.mockReturnValueOnce(okResponse(ws1));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => {
        expect(result.current.workspaces).toHaveLength(1);
      });

      mockFetch.mockReturnValueOnce(okResponse(ws2));

      await act(async () => {
        result.current.refetchWorkspaces();
      });

      await waitFor(() => {
        expect(result.current.workspaces).toHaveLength(2);
      });
    });
  });

});
