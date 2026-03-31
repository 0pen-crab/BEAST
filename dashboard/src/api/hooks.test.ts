import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ── Mock workspace ──────────────────────────────────────────────

const mockUseWorkspace = vi.fn(() => ({
  currentWorkspace: { id: 1, name: 'Test Workspace', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' },
  workspaces: [],
  switchWorkspace: vi.fn(),
  isLoading: false,
  needsOnboarding: false,
  refetchWorkspaces: vi.fn(),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: (...args: unknown[]) => mockUseWorkspace(...args),
}));

// ── Mock global fetch ───────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ─────────────────────────────────────────────────────

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc?: QueryClient) {
  const client = qc ?? createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function mockFetchSuccess(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchError(message: string, status = 500) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({ error: message }),
    text: () => Promise.resolve(message),
  });
}

function mockFetch204() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 204,
    json: () => Promise.reject(new Error('No content')),
    text: () => Promise.resolve(''),
  });
}

// ── Imports (after mocks) ───────────────────────────────────────

import {
  useTeams,
  useTeam,
  useRepositories,
  useRepository,
  useUpdateRepository,
  useDeleteRepository,
  useFindings,
  useFinding,
  useFindingCounts,
  useUpdateFinding,
  useScanEvents,
  useScanEventStats,
  useResolveScanEvent,
  useUnresolveScanEvent,
  useContributors,
  useContributor,
  useSources,
  useSource,
  useConnectSource,
  useSourceRepos,
  useImportFromSource,
  useSyncSource,
  useUpdateSource,
  useDeleteSource,
  useAddRepoUrl,
  useUploadRepoZip,
  useWorkspaceEvents,
  useBulkUpdateRepositories,
  useRepoReports,
  useRepositoryTests,
  useTest,
  useFindingNotes,
  useAddFindingNote,
  useContributorActivity,
  useContributorRepos,
  useContributorAssessments,
  useToolRegistry,
  useWorkspaceTools,
  useUpdateWorkspaceTools,
  useMergeContributors,
} from './hooks';

// ── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUseWorkspace.mockReturnValue({
    currentWorkspace: { id: 1, name: 'Test Workspace', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' },
    workspaces: [],
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────

describe('useTeams', () => {
  it('fetches teams with workspace_id', async () => {
    const teams = [{ id: 1, name: 'Team A', workspaceId: 1 }];
    mockFetchSuccess(teams);

    const { result } = renderHook(() => useTeams(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(teams);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/teams');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('is disabled when no workspace is selected', () => {
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    const { result } = renderHook(() => useTeams(), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses queryKey ["teams", wsId]', async () => {
    mockFetchSuccess([]);
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useTeams(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(['teams', 1])).toEqual([]);
  });
});

describe('useTeam', () => {
  it('fetches a single team by id', async () => {
    const team = { id: 5, name: 'Backend', workspaceId: 1 };
    mockFetchSuccess(team);

    const { result } = renderHook(() => useTeam(5), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(team);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/teams/5');
  });

  it('is disabled when id is 0', () => {
    const { result } = renderHook(() => useTeam(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('useRepositories', () => {
  it('fetches repositories with workspace_id', async () => {
    const repos = [{ id: 1, name: 'repo-a', teamId: 1 }];
    mockFetchSuccess(repos);

    const { result } = renderHook(() => useRepositories(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(repos);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/repositories');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('includes team_id param when provided', async () => {
    mockFetchSuccess([]);

    const { result } = renderHook(() => useRepositories({ team_id: 5 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('team_id=5');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('is disabled when no workspace', () => {
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    const { result } = renderHook(() => useRepositories(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('uses queryKey ["repositories", wsId, params]', async () => {
    mockFetchSuccess([]);
    const qc = createTestQueryClient();
    const params = { team_id: 3 };

    const { result } = renderHook(() => useRepositories(params), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(['repositories', 1, params])).toEqual([]);
  });
});

describe('useRepository', () => {
  it('fetches single repository by id', async () => {
    const repo = { id: 10, name: 'my-repo', teamId: 1 };
    mockFetchSuccess(repo);

    const { result } = renderHook(() => useRepository(10), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(repo);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/repositories/10');
  });

  it('is disabled when id is 0 or negative', () => {
    const { result } = renderHook(() => useRepository(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpdateRepository', () => {
  it('sends PUT request with body and invalidates repositories', async () => {
    const updatedRepo = { id: 3, name: 'updated', teamId: 1 };
    mockFetchSuccess(updatedRepo);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateRepository(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ id: 3, name: 'updated' });
    });

    // Verify fetch call
    expect(mockFetch).toHaveBeenCalledWith('/api/repositories/3', expect.objectContaining({
      method: 'PUT',
    }));
    // Headers is a Headers instance, not a plain object
    const putHeaders = mockFetch.mock.calls[0][1].headers;
    expect(putHeaders.get('Content-Type')).toBe('application/json');

    // Verify body was serialized correctly
    const fetchOptions = mockFetch.mock.calls[0][1];
    expect(JSON.parse(fetchOptions.body)).toEqual({ name: 'updated' });

    // Verify invalidation
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repositories'] });
  });

  it('sets query data for the specific repository on success', async () => {
    const updatedRepo = { id: 3, name: 'updated', teamId: 1 };
    mockFetchSuccess(updatedRepo);

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useUpdateRepository(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ id: 3, name: 'updated' });
    });

    expect(qc.getQueryData(['repository', 3])).toEqual(updatedRepo);
  });
});

describe('useDeleteRepository', () => {
  it('sends DELETE request and invalidates repositories + teams', async () => {
    mockFetch204();

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteRepository(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync(7);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/repositories/7', expect.objectContaining({
      method: 'DELETE',
    }));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repositories'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['teams'] });
  });
});

describe('useRepoReports', () => {
  it('fetches reports for a given repository', async () => {
    const reports = { summary: { content: '# Report', updatedAt: '2026-01-01' } };
    mockFetchSuccess(reports);

    const { result } = renderHook(() => useRepoReports(5), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/repositories/5/reports');
    expect(result.current.data).toEqual(reports);
  });

  it('is disabled when repositoryId is 0', () => {
    const { result } = renderHook(() => useRepoReports(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRepositoryTests', () => {
  it('fetches tests for a repository', async () => {
    const tests = [{ id: 1, tool: 'gitleaks', scanId: 'abc' }];
    mockFetchSuccess(tests);

    const { result } = renderHook(() => useRepositoryTests(4), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/tests');
    expect(calledUrl).toContain('repository_id=4');
  });

  it('is disabled when repositoryId is 0', () => {
    const { result } = renderHook(() => useRepositoryTests(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useTest', () => {
  it('fetches a single test by id', async () => {
    const test = { id: 9, tool: 'trivy', scanId: 'x' };
    mockFetchSuccess(test);

    const { result } = renderHook(() => useTest(9), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/tests/9');
  });

  it('is disabled when id is 0', () => {
    const { result } = renderHook(() => useTest(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useFindings', () => {
  it('fetches findings with workspace_id', async () => {
    const findings = { count: 1, results: [{ id: 1, title: 'SQL Injection' }] };
    mockFetchSuccess(findings);

    const { result } = renderHook(() => useFindings(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(findings);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/findings');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('includes filter params (severity, limit, status, tool)', async () => {
    mockFetchSuccess({ count: 0, results: [] });

    const params = { severity: 'High', limit: 10, status: 'open', tool: 'gitleaks' };
    const { result } = renderHook(() => useFindings(params), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('severity=High');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('status=open');
    expect(calledUrl).toContain('tool=gitleaks');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('includes sort and dir params', async () => {
    mockFetchSuccess({ count: 0, results: [] });

    const { result } = renderHook(() => useFindings({ sort: 'severity', dir: 'desc' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('sort=severity');
    expect(calledUrl).toContain('dir=desc');
  });

  it('is disabled when no workspace', () => {
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    const { result } = renderHook(() => useFindings(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does not include undefined params in URL', async () => {
    mockFetchSuccess({ count: 0, results: [] });

    const { result } = renderHook(
      () => useFindings({ severity: undefined, limit: 5 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).not.toContain('severity');
    expect(calledUrl).toContain('limit=5');
  });
});

describe('useFinding', () => {
  it('fetches a single finding by id', async () => {
    const finding = { id: 42, title: 'XSS', severity: 'High' };
    mockFetchSuccess(finding);

    const { result } = renderHook(() => useFinding(42), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/findings/42');
  });

  it('is disabled when id is 0', () => {
    const { result } = renderHook(() => useFinding(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useFindingCounts', () => {
  it('fetches finding counts with workspace_id', async () => {
    const counts = { Critical: 1, High: 2, Medium: 3, Low: 4, Info: 5, total: 15, riskAccepted: 0 };
    mockFetchSuccess(counts);

    const { result } = renderHook(() => useFindingCounts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(counts);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/findings/counts');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('includes repositoryId when provided', async () => {
    mockFetchSuccess({ Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0, total: 0, riskAccepted: 0 });

    const { result } = renderHook(() => useFindingCounts({ repositoryId: 10 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('repository_id=10');
  });

  it('includes testId when provided', async () => {
    mockFetchSuccess({ Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0, total: 0, riskAccepted: 0 });

    const { result } = renderHook(() => useFindingCounts({ testId: 7 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('test_id=7');
  });

  it('is disabled when no workspace', () => {
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    const { result } = renderHook(() => useFindingCounts(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useFindingNotes', () => {
  it('fetches notes for a finding', async () => {
    const notes = [{ id: 1, findingId: 5, content: 'note text' }];
    mockFetchSuccess(notes);

    const { result } = renderHook(() => useFindingNotes(5), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/findings/5/notes');
  });

  it('is disabled when findingId is 0', () => {
    const { result } = renderHook(() => useFindingNotes(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAddFindingNote', () => {
  it('posts a note and invalidates findingNotes', async () => {
    const newNote = { id: 2, findingId: 5, content: 'new note' };
    mockFetchSuccess(newNote);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useAddFindingNote(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ findingId: 5, entry: 'new note' });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/findings/5/notes', expect.objectContaining({
      method: 'POST',
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ content: 'new note' });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['findingNotes', 5] });
  });
});

describe('useUpdateFinding', () => {
  it('sends PATCH request and invalidates findings + findingCounts', async () => {
    const updatedFinding = { id: 10, title: 'XSS', status: 'risk_accepted' };
    mockFetchSuccess(updatedFinding);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateFinding(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ id: 10, status: 'risk_accepted' });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/findings/10', expect.objectContaining({
      method: 'PATCH',
    }));
    // Headers is a Headers instance, not a plain object
    const patchHeaders = mockFetch.mock.calls[0][1].headers;
    expect(patchHeaders.get('Content-Type')).toBe('application/json');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ status: 'risk_accepted' });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['findings'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['findingCounts'] });
  });

  it('invalidates the specific finding query on success', async () => {
    const updatedFinding = { id: 10, title: 'XSS', status: 'fixed' };
    mockFetchSuccess(updatedFinding);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateFinding(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ id: 10, status: 'fixed' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['finding', 10] });
    invalidateSpy.mockRestore();
  });
});

describe('useScanEvents', () => {
  it('fetches scan events with workspace_id', async () => {
    const events = { count: 1, results: [{ id: 1, level: 'info', message: 'Scan started' }] };
    mockFetchSuccess(events);

    const { result } = renderHook(() => useScanEvents(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(events);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/scan-events');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('includes filter params (level, source, limit)', async () => {
    mockFetchSuccess({ count: 0, results: [] });

    const { result } = renderHook(
      () => useScanEvents({ level: 'error', source: 'orchestrator', limit: 20 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('level=error');
    expect(calledUrl).toContain('source=orchestrator');
    expect(calledUrl).toContain('limit=20');
  });

  it('is disabled when no workspace', () => {
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    const { result } = renderHook(() => useScanEvents(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useScanEventStats', () => {
  it('fetches scan event stats with workspace_id', async () => {
    const stats = { unresolved: 3, unresolvedErrors: 1, unresolvedWarnings: 2, total: 10 };
    mockFetchSuccess(stats);

    const { result } = renderHook(() => useScanEventStats(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stats);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/scan-events/stats');
    expect(calledUrl).toContain('workspace_id=1');
  });
});

describe('useResolveScanEvent', () => {
  it('sends PATCH with resolved=true and invalidates scanEvents + scanEventStats', async () => {
    const resolved = { id: 5, resolved: true };
    mockFetchSuccess(resolved);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useResolveScanEvent(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ id: 5, resolved_by: 'admin' });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/scan-events/5', expect.objectContaining({
      method: 'PATCH',
    }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ resolved: true, resolved_by: 'admin' });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scanEvents'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scanEventStats'] });
  });
});

describe('useUnresolveScanEvent', () => {
  it('sends PATCH with resolved=false and invalidates scanEvents + scanEventStats', async () => {
    const unresolved = { id: 5, resolved: false };
    mockFetchSuccess(unresolved);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUnresolveScanEvent(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync(5);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/scan-events/5', expect.objectContaining({
      method: 'PATCH',
    }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ resolved: false });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scanEvents'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scanEventStats'] });
  });
});

describe('useContributors', () => {
  it('fetches contributors with workspace_id', async () => {
    const devs = { count: 1, results: [{ id: 1, displayName: 'Dev A' }] };
    mockFetchSuccess(devs);

    const { result } = renderHook(() => useContributors(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(devs);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/contributors');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('includes search and sort params', async () => {
    mockFetchSuccess({ count: 0, results: [] });

    const { result } = renderHook(
      () => useContributors({ search: 'alice', sort: 'total_commits', dir: 'desc', limit: 25 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('search=alice');
    expect(calledUrl).toContain('sort=total_commits');
    expect(calledUrl).toContain('dir=desc');
    expect(calledUrl).toContain('limit=25');
  });

  it('is disabled when no workspace', () => {
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    const { result } = renderHook(() => useContributors(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useContributor', () => {
  it('fetches a single contributor by id', async () => {
    const dev = { id: 3, displayName: 'Bob' };
    mockFetchSuccess(dev);

    const { result } = renderHook(() => useContributor(3), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/contributors/3');
  });

  it('is disabled when id is 0', () => {
    const { result } = renderHook(() => useContributor(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useContributorActivity', () => {
  it('fetches contributor activity with weeks param', async () => {
    const activity = [{ activityDate: '2026-01-01', commitCount: 5 }];
    mockFetchSuccess(activity);

    const { result } = renderHook(() => useContributorActivity(2, 12), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/contributors/2/activity?weeks=12');
  });

  it('defaults to 52 weeks', async () => {
    mockFetchSuccess([]);

    const { result } = renderHook(() => useContributorActivity(2), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/contributors/2/activity?weeks=52');
  });
});

describe('useContributorRepos', () => {
  it('fetches contributor repos', async () => {
    const repos = [{ id: 1, repoName: 'beast', commitCount: 100 }];
    mockFetchSuccess(repos);

    const { result } = renderHook(() => useContributorRepos(3), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/contributors/3/repos');
  });
});

describe('useContributorAssessments', () => {
  it('fetches contributor assessments', async () => {
    const assessments = [{ id: 1, contributorId: 4, scoreSecurity: 85 }];
    mockFetchSuccess(assessments);

    const { result } = renderHook(() => useContributorAssessments(4), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/contributors/4/assessments');
  });
});

describe('useMergeContributors', () => {
  it('calls POST /api/contributors/merge with source_id and target_id', async () => {
    mockFetchSuccess({ id: 2, displayName: 'Bob', emails: ['b@test.com', 'a@test.com'] });

    const { result } = renderHook(() => useMergeContributors(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ sourceId: 1, targetId: 2 });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/contributors/merge',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ source_id: 1, target_id: 2 }),
      }),
    );
  });
});

describe('useSources', () => {
  it('fetches sources with workspace_id', async () => {
    const srcs = [{ id: 1, provider: 'github', workspaceId: 1 }];
    mockFetchSuccess(srcs);

    const { result } = renderHook(() => useSources(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(srcs);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/sources');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('is disabled when no workspace', () => {
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    const { result } = renderHook(() => useSources(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useConnectSource', () => {
  it('sends POST with provider/token and invalidates sources, workspaceEvents', async () => {
    const created = { source: { id: 2, provider: 'bitbucket' }, discovered_repos: [] };
    mockFetchSuccess(created);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useConnectSource(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        workspace_id: 1,
        provider: 'bitbucket',
        base_url: 'https://api.bitbucket.org/2.0',
        org_name: 'my-org',
        access_token: 'tok',
      });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/sources', expect.objectContaining({
      method: 'POST',
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      workspace_id: 1,
      provider: 'bitbucket',
      base_url: 'https://api.bitbucket.org/2.0',
      org_name: 'my-org',
      access_token: 'tok',
    });

    // useConnectSource does NOT invalidate — caller handles it after import
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('sends POST with url for public source', async () => {
    const created = { source: { id: 3, provider: 'github' }, discovered_repos: [{ name: 'repo1' }] };
    mockFetchSuccess(created);

    const qc = createTestQueryClient();

    const { result } = renderHook(() => useConnectSource(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        workspace_id: 1,
        url: 'https://github.com/my-org',
      });
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      workspace_id: 1,
      url: 'https://github.com/my-org',
    });
  });
});

describe('useSyncSource', () => {
  it('sends POST to sync endpoint and invalidates sources, repositories, workspaceEvents', async () => {
    const syncResult = { added: 3, updated: 1 };
    mockFetchSuccess(syncResult);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useSyncSource(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync(5);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/sources/5/sync', expect.objectContaining({
      method: 'POST',
    }));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sourceRepos'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repositories'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaceEvents'] });
  });
});

describe('useDeleteSource', () => {
  it('sends DELETE and invalidates sources, repositories', async () => {
    mockFetch204();

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteSource(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync(3);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/sources/3', expect.objectContaining({
      method: 'DELETE',
    }));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repositories'] });
  });
});

describe('useSource', () => {
  it('fetches a single source by id', async () => {
    const source = { id: 3, provider: 'github', workspaceId: 1 };
    mockFetchSuccess(source);

    const { result } = renderHook(() => useSource(3), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(source);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/sources/3');
  });

  it('is disabled when id is 0', () => {
    const { result } = renderHook(() => useSource(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses queryKey ["source", id]', async () => {
    const source = { id: 7, provider: 'bitbucket', workspaceId: 1 };
    mockFetchSuccess(source);
    const qc = createTestQueryClient();

    const { result } = renderHook(() => useSource(7), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(['source', 7])).toEqual(source);
  });
});

describe('useSourceRepos', () => {
  it('fetches repos for a source by id', async () => {
    const repos = [{ slug: 'repo-a', cloneUrl: 'https://example.com/repo-a.git' }];
    mockFetchSuccess(repos);

    const { result } = renderHook(() => useSourceRepos(4), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(repos);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/sources/4/repos');
  });

  it('is disabled when sourceId is 0', () => {
    const { result } = renderHook(() => useSourceRepos(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses queryKey ["sourceRepos", sourceId]', async () => {
    mockFetchSuccess([]);
    const qc = createTestQueryClient();

    const { result } = renderHook(() => useSourceRepos(6), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(['sourceRepos', 6])).toEqual([]);
  });
});

describe('useUpdateSource', () => {
  it('sends PUT request and invalidates sources', async () => {
    const updatedSource = { id: 2, provider: 'bitbucket', prCommentsEnabled: true };
    mockFetchSuccess(updatedSource);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateSource(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ id: 2, prCommentsEnabled: true });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/sources/2', expect.objectContaining({
      method: 'PUT',
    }));
    // Headers is a Headers instance, not a plain object
    const sourceHeaders = mockFetch.mock.calls[0][1].headers;
    expect(sourceHeaders.get('Content-Type')).toBe('application/json');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ prCommentsEnabled: true });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sources'] });
  });

  it('can update syncIntervalMinutes', async () => {
    const updatedSource = { id: 5, provider: 'github', syncIntervalMinutes: 60 };
    mockFetchSuccess(updatedSource);

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useUpdateSource(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ id: 5, syncIntervalMinutes: 60 });
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ syncIntervalMinutes: 60 });
  });
});

describe('useImportFromSource', () => {
  it('sends POST with repos list and invalidates sources, sourceRepos, repositories, workspaceEvents', async () => {
    const importResult = { imported: 3 };
    mockFetchSuccess(importResult);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useImportFromSource(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ sourceId: 4, repos: ['repo-a', 'repo-b', 'repo-c'] });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/sources/4/import', expect.objectContaining({
      method: 'POST',
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ repos: ['repo-a', 'repo-b', 'repo-c'] });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sourceRepos'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repositories'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaceEvents'] });
  });
});

describe('useAddRepoUrl', () => {
  it('sends POST with repo URL and invalidates repositories, workspaceEvents', async () => {
    const addResult = { repository: { id: 10, name: 'new-repo', teamId: 1 } };
    mockFetchSuccess(addResult);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useAddRepoUrl(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        workspace_id: 1,
        repo_url: 'https://github.com/org/repo.git',
        team_id: 3,
      });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/repos/add-url', expect.objectContaining({
      method: 'POST',
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      workspace_id: 1,
      repo_url: 'https://github.com/org/repo.git',
      team_id: 3,
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repositories'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaceEvents'] });
  });

  it('sends POST without optional team_id', async () => {
    mockFetchSuccess({ repository: { id: 11, name: 'solo-repo' } });

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useAddRepoUrl(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        workspace_id: 1,
        repo_url: 'https://github.com/org/solo.git',
      });
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      workspace_id: 1,
      repo_url: 'https://github.com/org/solo.git',
    });
  });
});

describe('useUploadRepoZip', () => {
  it('sends POST with FormData and invalidates repositories, workspaceEvents', async () => {
    mockFetchSuccess({ repository: { id: 20, name: 'uploaded-repo' } });

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUploadRepoZip(), { wrapper: createWrapper(qc) });

    const file = new File(['zip content'], 'repo.zip', { type: 'application/zip' });

    await act(async () => {
      await result.current.mutateAsync({ workspaceId: 1, file, teamId: 2 });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/repos/upload'),
      expect.objectContaining({ method: 'POST' }),
    );

    // Verify FormData was sent (not JSON)
    const fetchOptions = mockFetch.mock.calls[0][1];
    expect(fetchOptions.body).toBeInstanceOf(FormData);

    const formData = fetchOptions.body as FormData;
    expect(formData.get('workspace_id')).toBe('1');
    expect(formData.get('team_id')).toBe('2');
    expect(formData.get('file')).toBeInstanceOf(File);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repositories'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaceEvents'] });
  });

  it('sends POST without optional teamId', async () => {
    mockFetchSuccess({ repository: { id: 21, name: 'no-team-repo' } });

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useUploadRepoZip(), { wrapper: createWrapper(qc) });

    const file = new File(['data'], 'repo.zip', { type: 'application/zip' });

    await act(async () => {
      await result.current.mutateAsync({ workspaceId: 1, file });
    });

    const formData = mockFetch.mock.calls[0][1].body as FormData;
    expect(formData.get('workspace_id')).toBe('1');
    expect(formData.get('team_id')).toBeNull();
    expect(formData.get('file')).toBeInstanceOf(File);
  });

  it('does not set Content-Type header (browser sets it with boundary for FormData)', async () => {
    mockFetchSuccess({ repository: { id: 22, name: 'zip-repo' } });

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useUploadRepoZip(), { wrapper: createWrapper(qc) });

    const file = new File(['data'], 'repo.zip', { type: 'application/zip' });

    await act(async () => {
      await result.current.mutateAsync({ workspaceId: 1, file });
    });

    const fetchOptions = mockFetch.mock.calls[0][1];
    // Auth headers are present, but Content-Type should NOT be set (browser sets it with boundary for FormData)
    expect(fetchOptions.headers['Content-Type']).toBeUndefined();
  });
});

describe('useWorkspaceEvents', () => {
  it('fetches workspace events with workspace_id', async () => {
    const events = { count: 2, results: [{ id: 1, eventType: 'repo.created' }] };
    mockFetchSuccess(events);

    const { result } = renderHook(() => useWorkspaceEvents(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(events);

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/workspace-events');
    expect(calledUrl).toContain('workspace_id=1');
  });

  it('includes optional params (limit, offset, event_type)', async () => {
    mockFetchSuccess({ count: 0, results: [] });

    const { result } = renderHook(
      () => useWorkspaceEvents({ limit: 10, offset: 5, event_type: 'scan.completed' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('offset=5');
    expect(calledUrl).toContain('event_type=scan.completed');
  });

  it('is disabled when no workspace', () => {
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    const { result } = renderHook(() => useWorkspaceEvents(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useBulkUpdateRepositories', () => {
  it('sends PATCH to /api/repositories/bulk and invalidates repositories + teams', async () => {
    const bulkResult = { updated: 3 };
    mockFetchSuccess(bulkResult);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useBulkUpdateRepositories(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ ids: [1, 2, 3], team_id: 5 });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/repositories/bulk', expect.objectContaining({
      method: 'PATCH',
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ ids: [1, 2, 3], team_id: 5 });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['repositories'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['teams'] });
  });

  it('can send status update in bulk', async () => {
    mockFetchSuccess({ updated: 2 });

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useBulkUpdateRepositories(), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ ids: [4, 5], status: 'ignored' });
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ ids: [4, 5], status: 'ignored' });
  });
});

// ── Error handling ──────────────────────────────────────────────

describe('Error handling', () => {
  it('query hook enters error state on non-OK response', async () => {
    mockFetchError('Internal Server Error', 500);

    const { result } = renderHook(() => useTeams(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Internal Server Error');
  });

  it('mutation hook throws on non-OK response', async () => {
    mockFetchError('Not Found', 404);

    const qc = createTestQueryClient();
    const { result } = renderHook(() => useUpdateRepository(), { wrapper: createWrapper(qc) });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: 999, name: 'bad' });
      }),
    ).rejects.toThrow('Not Found');
  });

  it('handles fetch rejection (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useTeams(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('handles response.text() failure gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('text parse failure')),
    });

    const { result } = renderHook(() => useTeams(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('HTTP 500');
  });

  it('mutation error for DELETE does not invalidate queries', async () => {
    mockFetchError('Forbidden', 403);

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteRepository(), { wrapper: createWrapper(qc) });

    try {
      await act(async () => {
        await result.current.mutateAsync(1);
      });
    } catch {
      // expected
    }

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// ── fetchApi / mutateApi behavior ───────────────────────────────

describe('fetchApi behavior', () => {
  it('passes the full URL from buildUrl to fetch', async () => {
    mockFetchSuccess([]);

    const { result } = renderHook(() => useTeams(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0][0];
    // buildUrl constructs full URL with origin
    expect(calledUrl).toMatch(/^https?:\/\//);
    expect(calledUrl).toContain('/api/teams');
  });
});

describe('mutateApi behavior', () => {
  it('sets Content-Type header to application/json', async () => {
    const repo = { id: 1, name: 'test' };
    mockFetchSuccess(repo);

    const { result } = renderHook(() => useUpdateRepository(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ id: 1, name: 'test' });
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('returns undefined for 204 responses', async () => {
    mockFetch204();

    const { result } = renderHook(() => useDeleteRepository(), { wrapper: createWrapper() });

    let response: unknown;
    await act(async () => {
      response = await result.current.mutateAsync(1);
    });

    expect(response).toBeUndefined();
  });
});

// ── Tool Configuration ──────────────────────────────────────────

describe('useToolRegistry', () => {
  it('fetches tool registry from /api/tools/registry', async () => {
    const tools = [
      { key: 'gitleaks', displayName: 'Gitleaks', category: 'secrets', recommended: true },
      { key: 'trivy', displayName: 'Trivy', category: 'sca', recommended: true },
    ];
    mockFetchSuccess(tools);

    const { result } = renderHook(() => useToolRegistry(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(tools);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/tools/registry');
  });

  it('uses queryKey ["tool-registry"]', async () => {
    mockFetchSuccess([]);
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useToolRegistry(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(['tool-registry'])).toEqual([]);
  });

  it('has staleTime set to Infinity (does not refetch automatically)', async () => {
    mockFetchSuccess([]);
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useToolRegistry(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // After initial fetch, re-render should not trigger another fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.isStale).toBe(false);
  });
});

describe('useWorkspaceTools', () => {
  it('fetches workspace tools with workspace id', async () => {
    const tools = [
      { tool_key: 'gitleaks', enabled: true, has_credentials: false },
      { tool_key: 'trivy', enabled: true, has_credentials: false },
    ];
    mockFetchSuccess(tools);

    const { result } = renderHook(() => useWorkspaceTools(42), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(tools);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/workspaces/42/tools');
  });

  it('is disabled when workspaceId is undefined', () => {
    const { result } = renderHook(() => useWorkspaceTools(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses queryKey ["workspace-tools", workspaceId]', async () => {
    mockFetchSuccess([]);
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useWorkspaceTools(7), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(['workspace-tools', 7])).toEqual([]);
  });
});

describe('useUpdateWorkspaceTools', () => {
  it('sends PUT to /api/workspaces/:id/tools with tool selections', async () => {
    mockFetchSuccess({ ok: true });

    const { result } = renderHook(() => useUpdateWorkspaceTools(42), { wrapper: createWrapper() });

    const toolPayload = [
      { tool_key: 'gitleaks', enabled: true },
      { tool_key: 'trivy', enabled: false },
    ];

    await act(async () => {
      await result.current.mutateAsync(toolPayload);
    });

    expect(mockFetch.mock.calls[0][0]).toBe('/api/workspaces/42/tools');
    const fetchOptions = mockFetch.mock.calls[0][1];
    expect(fetchOptions.method).toBe('PUT');
    expect(JSON.parse(fetchOptions.body)).toEqual({ tools: toolPayload });
  });

  it('invalidates workspace-tools query on success', async () => {
    mockFetchSuccess({ ok: true });

    const qc = createTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateWorkspaceTools(42), { wrapper: createWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync([{ tool_key: 'gitleaks', enabled: true }]);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace-tools', 42] });
  });

  it('supports credentials in tool payload', async () => {
    mockFetchSuccess({ ok: true });

    const { result } = renderHook(() => useUpdateWorkspaceTools(10), { wrapper: createWrapper() });

    const toolPayload = [
      { tool_key: 'snyk', enabled: true, credentials: { SNYK_TOKEN: 'tok_123' } },
    ];

    await act(async () => {
      await result.current.mutateAsync(toolPayload);
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools[0].credentials).toEqual({ SNYK_TOKEN: 'tok_123' });
  });
});
