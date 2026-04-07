import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/lib/workspace';
import type {
  PaginatedResponse,
  Team,
  Repository,
  Test,
  Finding,
  FindingNote,
  FindingCounts,
  ScanDetail,
  ScanEvent,
  ScanEventStats,
  Source,
  DiscoveredRepo,
  WorkspaceEvent,
  PullRequestSummary,
  PullRequestDetail,
  WorkspaceMember,
  AddMemberResponse,
  AdminUser,
  AdminWorkspace,
  ToolDefinition,
  WorkspaceToolSelection,
} from './types';

// ── Fetch helpers (from global API client) ───────────────────
// All API requests go through apiFetch which auto-injects auth headers.
// NEVER use raw fetch() for /api/* calls.

import { apiFetch, fetchApi, mutateApi } from './client';
import type {
  Contributor,
  ContributorRepoStats,
  ContributorDailyActivity,
  ContributorAssessment,
} from './contributor-types';

// Re-export for the rare case someone needs raw apiFetch (e.g. FormData uploads)
export { apiFetch };

export function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

// ── Teams ──────────────────────────────────────────────────────

export function useTeams() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['teams', wsId],
    queryFn: () => fetchApi<Team[]>(buildUrl('/api/teams', { workspace_id: wsId })),
    enabled: !!wsId,
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      mutateApi<Team>('/api/teams', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: currentWorkspace!.id, name, description }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useTeam(id: number) {
  return useQuery({
    queryKey: ['team', id],
    queryFn: () => fetchApi<Team>(`/api/teams/${id}`),
    enabled: id > 0,
  });
}

export function useTeamContributors(teamId: number) {
  return useQuery({
    queryKey: ['teamContributors', teamId],
    queryFn: () => fetchApi<Contributor[]>(`/api/teams/${teamId}/contributors`),
    enabled: teamId > 0,
  });
}

// ── Repositories ───────────────────────────────────────────────

export function useRepositories(params?: { team_id?: number }) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const query = useQuery({
    queryKey: ['repositories', wsId, params],
    queryFn: () =>
      fetchApi<Repository[]>(
        buildUrl('/api/repositories', { workspace_id: wsId, ...params }),
      ),
    enabled: !!wsId,
    refetchInterval: (query) => {
      const repos = query.state.data;
      const hasActive = repos?.some((r) => r.status === 'queued' || r.status === 'analyzing');
      return hasActive ? 3_000 : false;
    },
  });
  return query;
}

export function useRepository(id: number) {
  return useQuery({
    queryKey: ['repository', id],
    queryFn: () => fetchApi<Repository>(`/api/repositories/${id}`),
    enabled: id > 0,
  });
}

export function useUpdateRepository() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<Repository>) =>
      mutateApi<Repository>(`/api/repositories/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['repositories'] });
      qc.setQueryData(['repository', data.id], data);
    },
  });
}

export function useDeleteRepository() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      mutateApi<void>(`/api/repositories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repositories'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

// ── Repository Reports ──────────────────────────────────────────

export function useRepoReports(repositoryId: number) {
  return useQuery({
    queryKey: ['repoReports', repositoryId],
    queryFn: () =>
      fetchApi<Record<string, { content: string; updated_at: string }>>(
        `/api/repositories/${repositoryId}/reports`,
      ),
    enabled: repositoryId > 0,
  });
}

// ── Scan Artifacts ──────────────────────────────────────────────

interface ScanArtifact {
  id: number;
  fileName: string;
  tool: string;
  createdAt: string;
}

export function useScanArtifacts(repositoryId: number) {
  return useQuery({
    queryKey: ['scanArtifacts', repositoryId],
    queryFn: () =>
      fetchApi<{ scanId: string; artifacts: ScanArtifact[] }>(
        `/api/scan-artifacts/${repositoryId}`,
      ),
    enabled: repositoryId > 0,
  });
}

// ── Tests ──────────────────────────────────────────────────────

export function useRepositoryTests(repositoryId: number) {
  return useQuery({
    queryKey: ['repositoryTests', repositoryId],
    queryFn: () =>
      fetchApi<Test[]>(buildUrl('/api/tests', { repository_id: repositoryId })),
    enabled: repositoryId > 0,
  });
}

export function useTest(id: number) {
  return useQuery({
    queryKey: ['test', id],
    queryFn: () => fetchApi<Test>(`/api/tests/${id}`),
    enabled: id > 0,
    staleTime: 5 * 60_000,
  });
}

// ── Findings ───────────────────────────────────────────────────

export function useFindings(params?: {
  repository_id?: number;
  test_id?: number;
  severity?: string;
  status?: string;
  tool?: string;
  duplicate?: boolean;
  limit?: number;
  offset?: number;
  sort?: string;
  dir?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['findings', wsId, params],
    queryFn: () =>
      fetchApi<PaginatedResponse<Finding>>(
        buildUrl('/api/findings', {
          workspace_id: wsId,
          ...params,
        } as Record<string, string | number | boolean | undefined>),
      ),
    enabled: !!wsId,
  });
}

export function useFinding(id: number) {
  return useQuery({
    queryKey: ['finding', id],
    queryFn: () => fetchApi<Finding>(`/api/findings/${id}`),
    enabled: id > 0,
  });
}

export function useFindingCounts(params?: {
  repositoryId?: number;
  testId?: number;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['findingCounts', wsId, params],
    queryFn: () =>
      fetchApi<FindingCounts>(
        buildUrl('/api/findings/counts', {
          workspace_id: wsId,
          ...(params?.repositoryId ? { repository_id: params.repositoryId } : {}),
          ...(params?.testId ? { test_id: params.testId } : {}),
        }),
      ),
    enabled: !!wsId,
  });
}

export function useFindingCountsByTool(repositoryIds?: number[]) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const repoIdsParam = repositoryIds?.length ? repositoryIds.join(',') : undefined;
  return useQuery({
    queryKey: ['findingCountsByTool', wsId, repoIdsParam],
    queryFn: () =>
      fetchApi<{ tool: string; active: number; dismissed: number }[]>(
        buildUrl('/api/findings/counts-by-tool', { workspace_id: wsId, repository_ids: repoIdsParam }),
      ),
    enabled: !!wsId,
  });
}

export function useFindingNotes(findingId: number) {
  return useQuery({
    queryKey: ['findingNotes', findingId],
    queryFn: () => fetchApi<FindingNote[]>(`/api/findings/${findingId}/notes`),
    enabled: findingId > 0,
  });
}

export function useAddFindingNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, entry }: { findingId: number; entry: string }) =>
      mutateApi<FindingNote>(`/api/findings/${findingId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: entry }),
      }),
    onSuccess: (_, { findingId }) => {
      qc.invalidateQueries({ queryKey: ['findingNotes', findingId] });
    },
  });
}

export function useUpdateFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; status?: string; riskAcceptedReason?: string }) =>
      mutateApi<Finding>(`/api/findings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['findings'] });
      qc.invalidateQueries({ queryKey: ['findingCounts'] });
      qc.invalidateQueries({ queryKey: ['finding', data.id] });
    },
  });
}

// ── Scan Events ───────────────────────────────────────────────

export function useScanEvents(params?: {
  limit?: number;
  offset?: number;
  level?: string;
  source?: string;
  repo_name?: string;
  scan_id?: string;
  step_name?: string;
  resolved?: boolean;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['scanEvents', wsId, params],
    queryFn: () =>
      fetchApi<{ count: number; results: ScanEvent[] }>(
        buildUrl('/api/scan-events', {
          workspace_id: wsId,
          ...params,
        } as Record<string, string | number | boolean | undefined>),
      ),
    enabled: !!wsId,
  });
}

export function useScanEventStats() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['scanEventStats', wsId],
    queryFn: () =>
      fetchApi<ScanEventStats>(buildUrl('/api/scan-events/stats', { workspace_id: wsId })),
    enabled: !!wsId,
    refetchInterval: 30_000,
  });
}

export function useResolveScanEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolved_by }: { id: number; resolved_by?: string }) =>
      mutateApi<ScanEvent>(`/api/scan-events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true, resolved_by }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scanEvents'] });
      qc.invalidateQueries({ queryKey: ['scanEventStats'] });
    },
  });
}

export function useUnresolveScanEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      mutateApi<ScanEvent>(`/api/scan-events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: false }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scanEvents'] });
      qc.invalidateQueries({ queryKey: ['scanEventStats'] });
    },
  });
}

// ── Contributors ──────────────────────────────────────────────

export function useContributors(params?: {
  limit?: number;
  offset?: number;
  sort?: string;
  dir?: string;
  search?: string;
}) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['contributors', wsId, params],
    queryFn: () =>
      fetchApi<{ count: number; results: Contributor[] }>(
        buildUrl('/api/contributors', {
          workspace_id: wsId,
          ...params,
        } as Record<string, string | number | boolean | undefined>),
      ),
    enabled: !!wsId,
  });
}

export function useBulkUpdateContributors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: number[]; team_id: number | null }) =>
      mutateApi<{ updated: number }>('/api/contributors/bulk', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributors'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useContributor(id: number) {
  return useQuery({
    queryKey: ['contributor', id],
    queryFn: () => fetchApi<Contributor>(`/api/contributors/${id}`),
    enabled: id > 0,
  });
}

export function useContributorActivity(id: number, weeks = 52) {
  return useQuery({
    queryKey: ['contributorActivity', id, weeks],
    queryFn: () =>
      fetchApi<ContributorDailyActivity[]>(`/api/contributors/${id}/activity?weeks=${weeks}`),
    enabled: id > 0,
  });
}

export function useContributorRepos(id: number) {
  return useQuery({
    queryKey: ['contributorRepos', id],
    queryFn: () => fetchApi<ContributorRepoStats[]>(`/api/contributors/${id}/repos`),
    enabled: id > 0,
  });
}

export function useContributorAssessments(id: number) {
  return useQuery({
    queryKey: ['contributorAssessments', id],
    queryFn: () =>
      fetchApi<ContributorAssessment[]>(`/api/contributors/${id}/assessments`),
    enabled: id > 0,
  });
}

export function useMergeContributors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: number; targetId: number }) =>
      mutateApi<Contributor>('/api/contributors/merge', {
        method: 'POST',
        body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributors'] });
      qc.invalidateQueries({ queryKey: ['contributor'] });
    },
  });
}

// ── Sources ─────────────────────────────────────────────────

export function useSources(explicitWsId?: number) {
  const { currentWorkspace } = useWorkspace();
  const wsId = explicitWsId ?? currentWorkspace?.id;
  return useQuery({
    queryKey: ['sources', wsId],
    queryFn: () => fetchApi<Source[]>(buildUrl('/api/sources', { workspace_id: wsId })),
    enabled: !!wsId,
  });
}

export function useSource(id: number) {
  return useQuery({
    queryKey: ['source', id],
    queryFn: () => fetchApi<Source>(`/api/sources/${id}`),
    enabled: id > 0,
  });
}

export function useConnectSource() {
  return useMutation({
    mutationFn: (body:
      | { workspace_id: number; url: string; access_token?: string }
      | {
          workspace_id: number;
          provider: string;
          base_url: string;
          org_name?: string;
          access_token: string;
          username?: string;
        }
    ) => mutateApi<{ source: Source; discovered_repos: DiscoveredRepo[]; discovery_error?: string }>(
      '/api/sources',
      { method: 'POST', body: JSON.stringify(body) },
    ),
    onSuccess: () => {
      // Don't invalidate sources here — let the caller do it after import is complete
    },
  });
}

export function useSourceRepos(sourceId: number) {
  return useQuery({
    queryKey: ['sourceRepos', sourceId],
    queryFn: () => fetchApi<DiscoveredRepo[]>(`/api/sources/${sourceId}/repos`),
    enabled: sourceId > 0,
  });
}

export function useImportFromSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, repos }: { sourceId: number; repos: string[] }) =>
      mutateApi<{ imported: number }>(`/api/sources/${sourceId}/import`, {
        method: 'POST',
        body: JSON.stringify({ repos }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['sourceRepos'] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
      qc.invalidateQueries({ queryKey: ['workspaceEvents'] });
    },
  });
}

export function useSyncSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => mutateApi<{ added: number; updated: number }>(
      `/api/sources/${id}/sync`,
      { method: 'POST' },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['sourceRepos'] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
      qc.invalidateQueries({ queryKey: ['workspaceEvents'] });
    },
  });
}

export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; prCommentsEnabled?: boolean; syncIntervalMinutes?: number }) =>
      mutateApi<Source>(`/api/sources/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => mutateApi<void>(`/api/sources/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
}

export function useAddRepoUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { workspace_id: number; repo_url: string; team_id?: number }) =>
      mutateApi<{ repository: Repository }>('/api/repos/add-url', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repositories'] });
      qc.invalidateQueries({ queryKey: ['workspaceEvents'] });
    },
  });
}

export function useUploadRepoZip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, file, teamId }: { workspaceId: number; file: File; teamId?: number }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workspace_id', String(workspaceId));
      if (teamId) formData.append('team_id', String(teamId));

      const res = await apiFetch(`/api/repos/upload?workspace_id=${workspaceId}`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text().catch((err) => {
          console.error('[hooks] Failed to read upload error response:', err);
          return `HTTP ${res.status}`;
        });
        let message = text;
        try { const parsed = JSON.parse(text); message = parsed.error ?? parsed.message ?? text; } catch { /* response is not JSON */ }
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
      qc.invalidateQueries({ queryKey: ['workspaceEvents'] });
    },
  });
}

// ── Trigger Scan ──────────────────────────────────────────

export function useTriggerScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { repositoryId: number; branch?: string; scanType?: string }) =>
      mutateApi<any>('/api/scans', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['scan-stats'] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
}

// ── Scans ──────────────────────────────────────────────────

export function useScans(params?: { status?: string; limit?: number }) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['scans', wsId, params],
    queryFn: () => fetchApi<{ count: number; results: ScanDetail[] }>(
      buildUrl('/api/scans', { workspace_id: wsId, ...params }),
    ),
    enabled: !!wsId,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActive = data?.results.some(s => s.status === 'running' || s.status === 'queued');
      return hasActive ? 5_000 : false;
    },
  });
}

export function useScanDetail(id: string | null) {
  return useQuery({
    queryKey: ['scan', id],
    queryFn: () => fetchApi<ScanDetail>(`/api/scans/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d && (d.status === 'running' || d.status === 'queued')) return 3_000;
      return false;
    },
  });
}

export function useScanLogs(scanId: string | null) {
  return useQuery({
    queryKey: ['scan-logs', scanId],
    queryFn: () => fetchApi<Array<{ step: string; fileName: string; createdAt: string }>>(`/api/scan-logs/${scanId}`),
    enabled: scanId !== null,
    staleTime: Infinity,
  });
}

export function useScanLogContent(scanId: string | null, step: string | null) {
  return useQuery({
    queryKey: ['scan-log-content', scanId, step],
    queryFn: async () => {
      const res = await fetch(`/api/scan-logs/${scanId}/${step}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('beast_token')}` },
      });
      if (!res.ok) throw new Error('Log not found');
      return res.text();
    },
    enabled: scanId !== null && step !== null,
    staleTime: Infinity,
  });
}

export function useScanStats() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['scan-stats', wsId],
    queryFn: () => fetchApi<{
      total: number; queued: number; running: number;
      completed: number; failed: number;
      avg_duration_sec: number | null;
    }>(buildUrl('/api/scans/stats', { workspace_id: wsId })),
    enabled: !!wsId,
    refetchInterval: 5_000,
  });
}

export function useCancelScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutateApi<{ cancelled: boolean }>(`/api/scans/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['scan-stats'] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
}

export function useRemoveScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutateApi<{ deleted: boolean }>(`/api/scans/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['scan-stats'] });
    },
  });
}

// ── Pull Requests ─────────────────────────────────────────

export function usePullRequests(repositoryId: number) {
  return useQuery({
    queryKey: ['pullRequests', repositoryId],
    queryFn: () => fetchApi<PullRequestSummary[]>(
      buildUrl('/api/pull-requests', { repository_id: repositoryId }),
    ),
    enabled: repositoryId > 0,
  });
}

export function usePullRequest(id: number) {
  return useQuery({
    queryKey: ['pullRequest', id],
    queryFn: () => fetchApi<PullRequestDetail>(`/api/pull-requests/${id}`),
    enabled: id > 0,
  });
}

export function useScanPullRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: number) => mutateApi<any>(
      `/api/pull-requests/${prId}/scan`,
      { method: 'POST' },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pullRequests'] });
      qc.invalidateQueries({ queryKey: ['pullRequest'] });
      qc.invalidateQueries({ queryKey: ['scans'] });
    },
  });
}

// ── Workspace Events ─────────────────────────────────────────

export function useWorkspaceEvents(params?: { limit?: number; offset?: number; event_type?: string }) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  return useQuery({
    queryKey: ['workspaceEvents', wsId, params],
    queryFn: () => fetchApi<{ count: number; results: WorkspaceEvent[] }>(
      buildUrl('/api/workspace-events', { workspace_id: wsId, ...params } as Record<string, string | number | boolean | undefined>),
    ),
    enabled: !!wsId,
  });
}

// ── Bulk Repository Operations ───────────────────────────────

export function useBulkUpdateRepositories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: number[]; team_id?: number; status?: string }) =>
      mutateApi<{ updated: number }>('/api/repositories/bulk', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repositories'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

// ── Admin hooks ──────────────────────────────────────────────

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => fetchApi<AdminUser[]>('/api/admin/users'),
  });
}

export function useAdminWorkspaces() {
  return useQuery({
    queryKey: ['admin', 'workspaces'],
    queryFn: () => fetchApi<AdminWorkspace[]>('/api/admin/workspaces'),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { username: string; displayName?: string }) =>
      mutateApi<{ id: number; username: string; displayName: string | null; role: string; generatedPassword: string }>(
        '/api/admin/users',
        { method: 'POST', body: JSON.stringify(data) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; displayName?: string; resetPassword?: boolean }) =>
      mutateApi<{ id: number; username: string; displayName: string | null; role: string; generatedPassword?: string }>(
        `/api/admin/users/${id}`,
        { method: 'PATCH', body: JSON.stringify(data) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      mutateApi<{ deleted: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

// ── Workspace member hooks ───────────────────────────────────

export function useWorkspaceMembers(workspaceId: number | undefined) {
  return useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => fetchApi<WorkspaceMember[]>(`/api/workspaces/${workspaceId}/members`),
    enabled: !!workspaceId,
  });
}

export function useAddWorkspaceMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, username, role }: { workspaceId: number; username: string; role: string }) =>
      mutateApi<AddMemberResponse>(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        body: JSON.stringify({ username, role }),
      }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['workspace-members', vars.workspaceId] }),
  });
}

export function useUpdateWorkspaceMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, userId, role }: { workspaceId: number; userId: number; role: string }) =>
      mutateApi<WorkspaceMember>(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['workspace-members', vars.workspaceId] }),
  });
}

export function useRemoveWorkspaceMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, userId }: { workspaceId: number; userId: number }) =>
      mutateApi<{ deleted: boolean }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['workspace-members', vars.workspaceId] }),
  });
}

// ── Password change ──────────────────────────────────────────

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ newPassword }: { newPassword: string }) =>
      mutateApi<{ ok: boolean }>('/api/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ newPassword }),
      }),
  });
}

// ── Tool Configuration ────────────────────────────────────────

export function useToolRegistry() {
  return useQuery({
    queryKey: ['tool-registry'],
    queryFn: () => fetchApi<ToolDefinition[]>('/api/tools/registry'),
    staleTime: Infinity,
  });
}

export function useWorkspaceTools(workspaceId: number | undefined) {
  return useQuery({
    queryKey: ['workspace-tools', workspaceId],
    queryFn: () => fetchApi<WorkspaceToolSelection[]>(`/api/workspaces/${workspaceId}/tools`),
    enabled: !!workspaceId,
  });
}

export function useUpdateWorkspaceTools(workspaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tools: Array<{ tool_key: string; enabled: boolean; credentials?: Record<string, string> }>) =>
      mutateApi<{ ok: boolean }>(`/api/workspaces/${workspaceId}/tools`, {
        method: 'PUT',
        body: JSON.stringify({ tools }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-tools', workspaceId] });
    },
  });
}

export function useValidateToken(workspaceId: number | undefined) {
  return useMutation({
    mutationFn: async (body: { tool_key: string; credentials: Record<string, string> }) => {
      const res = await apiFetch(`/api/workspaces/${workspaceId}/tools/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch((err) => {
          console.error('[hooks] Failed to parse validation error response:', err);
          return { error: 'Validation failed' };
        });
        throw new Error(JSON.stringify(data));
      }
      return res.json() as Promise<{ valid: boolean; error?: string }>;
    },
  });
}

export function useDisconnectTool(workspaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (toolKey: string) => {
      const res = await apiFetch(`/api/workspaces/${workspaceId}/tools/credentials`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_key: toolKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch((err) => {
          console.error('[hooks] Failed to parse disconnect error response:', err);
          return { error: 'Failed to disconnect' };
        });
        throw new Error(data.error ?? 'Failed to disconnect');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-tools', workspaceId] });
    },
  });
}


// ── Claude Status ────────────────────────────────────────────

export interface ClaudeStatusResponse {
  status: 'authenticated' | 'not_authenticated' | 'unreachable';
  message?: string;
}

export function useClaudeStatus() {
  return useQuery({
    queryKey: ['claude-status'],
    queryFn: () => fetchApi<ClaudeStatusResponse>('/api/claude-status'),
    staleTime: 0,
  });
}

// ── Worker Status ───────────────────────────────────────────

export interface WorkerStatusResponse {
  paused: boolean;
  reason?: string;
  resumesAt?: string;
  pausedAt?: string;
}

export function useWorkerStatus() {
  return useQuery({
    queryKey: ['worker-status'],
    queryFn: () => fetchApi<WorkerStatusResponse>('/api/worker-status'),
    refetchInterval: 30_000,
  });
}

export function useResumeWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => mutateApi('/api/worker/resume', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['worker-status'] }),
  });
}

// ── AI Settings ──────────────────────────────────────────────

export function useUpdateAiSettings(workspaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: {
      ai_analysis_enabled?: boolean;
      ai_scanning_enabled?: boolean;
      ai_triage_enabled?: boolean;
    }) =>
      mutateApi<Record<string, unknown>>(`/api/workspaces/${workspaceId}`, {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}
