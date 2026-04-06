import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRepositories, useTeams, useSources, useBulkUpdateRepositories, useTriggerScan, useFindingCountsByTool } from '@/api/hooks';
import { ProviderIcon } from '@/lib/provider-icons';
import { apiFetch, fetchApi } from '@/api/client';
import { useWorkspace } from '@/lib/workspace';
import { generateFindingsMarkdown, generateFindingsCsv, downloadFile, downloadAsZip, type ExportFinding } from '@/lib/export-findings';
import { ExportDialog, type ExportFormat } from '@/components/export-dialog';
import type { Finding } from '@/api/types';
import { TableSkeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { ErrorBoundary } from '@/components/error-boundary';
import { cn } from '@/lib/utils';
import { formatBytes, formatDate } from '@/lib/format';
import type { Repository } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { useCurrentWorkspaceRole, canWrite } from '@/lib/permissions';
import { ChipFilter, type FilterColumn, type ActiveFilter } from '@/components/filters/chip-filter';
import { Pagination } from '@/components/pagination';

const PAGE_SIZE = 25;

/** Parse human-friendly size string ("100MB", "1.5 GB", "500kb") to bytes. */
function parseSizeInput(raw: string): number | undefined {
  if (!raw) return undefined;
  const match = raw.trim().match(/^([\d.]+)\s*(b|kb|mb|gb|tb)?$/i);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  return Math.round(num * (multipliers[unit] ?? 1));
}

/** Format a range filter label for display in chip. */
function formatRangeLabel(min: number | undefined, max: number | undefined, fmt: (n: number) => string): string {
  if (min != null && max != null) return `${fmt(min)} — ${fmt(max)}`;
  if (min != null) return `≥ ${fmt(min)}`;
  if (max != null) return `≤ ${fmt(max)}`;
  return '';
}

// ── Column visibility ────────────────────────────────────────────
type ColumnKey = 'status' | 'team' | 'source' | 'language' | 'size' | 'abandoned' | 'riskScore' | 'findingsCount' | 'lastScannedAt' | 'updatedAt';

const COLUMNS: { key: ColumnKey; labelKey: string; align?: 'right' }[] = [
  { key: 'status', labelKey: 'repos.statusFilter' },
  { key: 'team', labelKey: 'repos.team' },
  { key: 'source', labelKey: 'repos.source' },
  { key: 'language', labelKey: 'repos.language' },
  { key: 'size', labelKey: 'repos.size', align: 'right' },
  { key: 'abandoned', labelKey: 'repos.maintained' },
  { key: 'riskScore', labelKey: 'repos.riskScore', align: 'right' },
  { key: 'findingsCount', labelKey: 'repos.findingsCol', align: 'right' },
  { key: 'lastScannedAt', labelKey: 'repos.lastScanned', align: 'right' },
  { key: 'updatedAt', labelKey: 'repos.lastUpdated', align: 'right' },
];

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ['status', 'size', 'riskScore', 'findingsCount', 'lastScannedAt'];

const COL_KEY = 'beast_repo_columns';

function loadVisibleColumns(): Set<ColumnKey> {
  try {
    const stored = localStorage.getItem(COL_KEY);
    if (stored) return new Set(JSON.parse(stored) as ColumnKey[]);
  } catch (err) {
    console.error('[repos] Failed to parse stored column settings, using defaults:', err);
  }
  return new Set(DEFAULT_VISIBLE_COLUMNS);
}

function ColumnSettingsDropdown({
  visible,
  onToggle,
  onClose,
}: {
  visible: Set<ColumnKey>;
  onToggle: (key: ColumnKey) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="beast-dropdown" style={{ width: '12rem' }}>
      {COLUMNS.map((col) => (
        <label key={col.key} className="beast-dropdown-item">
          <input
            type="checkbox"
            checked={visible.has(col.key)}
            onChange={() => onToggle(col.key)}
            className="beast-checkbox"
          />
          {t(col.labelKey)}
        </label>
      ))}
    </div>
  );
}

/** Build the POST /api/scans request body for a given repo. */
export function buildScanBody(repo: { id: number }) {
  return { repositoryId: repo.id };
}

/** Returns array of 0-based page indices and '...' ellipsis markers for pagination. */
// ── Risk score badge ────────────────────────────────────────────

function RiskScoreBadge({ score }: { score: number }) {
  const cls = score === 0 ? 'beast-risk-none'
    : score < 3 ? 'beast-risk-low'
    : score < 6 ? 'beast-risk-medium'
    : score < 8 ? 'beast-risk-high'
    : 'beast-risk-critical';
  return <span className={cn('beast-risk-badge', cls)}>{score.toFixed(1)}</span>;
}

// ── Status badge styles ────────────────────────────────────────

const STATUS_PILL_MAP: Record<string, string> = {
  pending:   'status-queued',
  queued:    'status-running',
  analyzing: 'status-running',
  completed: 'status-completed',
  failed:    'status-failed',
  ignored:   'status-queued',
};

function RepoStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const pillClass = STATUS_PILL_MAP[status] ?? 'status-queued';
  const label = t(`repos.status${status.charAt(0).toUpperCase() + status.slice(1)}`);
  return (
    <span className={cn(
      'status-pill',
      pillClass,
      status === 'analyzing' && 'animate-pulse',
    )}>
      {label}
    </span>
  );
}

function isAbandoned(lastActivityAt: string | null | undefined): boolean {
  if (!lastActivityAt) return false;
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return new Date(lastActivityAt) < oneYearAgo;
}

// ── Team assignment dropdown ────────────────────────────────────

function TeamAssignDropdown({
  teams,
  onAssign,
  isAssigning,
  onClose,
}: {
  teams: { id: number; name: string }[];
  onAssign: (teamId: number) => void;
  isAssigning: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="beast-dropdown" style={{ width: '13rem' }}>
      <div className="beast-dropdown-header">
        {t('repos.selectTeam')}
      </div>
      <div className="beast-dropdown-scroll">
        {teams.map((team) => (
          <button
            key={team.id}
            onClick={() => onAssign(team.id)}
            disabled={isAssigning}
            className="beast-dropdown-item beast-dropdown-item-danger"
          >
            {team.name}
          </button>
        ))}
        {teams.length === 0 && (
          <div className="beast-dropdown-item" style={{ cursor: 'default' }}>{t('teams.noTeams')}</div>
        )}
      </div>
    </div>
  );
}

// ── Sortable header ──────────────────────────────────────────────

type SortField = 'name' | 'status' | 'team' | 'source' | 'language' | 'size' | 'abandoned' | 'riskScore' | 'findingsCount' | 'lastScannedAt' | 'updatedAt';
type SortDir = 'asc' | 'desc';

function SortableHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
  align,
}: {
  field: SortField;
  label: string;
  sortField: SortField | null;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  align?: 'right';
}) {
  const active = sortField === field;
  return (
    <th className={cn(align === 'right' && 'beast-th-right')}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'beast-th-sort',
          active && 'beast-th-sort-active',
        )}
      >
        {label}
        <span className="beast-sort-arrows">
          <span className={active && sortDir === 'asc' ? 'active' : ''}>&#9650;</span>
          <span className={active && sortDir === 'desc' ? 'active' : ''}>&#9660;</span>
        </span>
      </button>
    </th>
  );
}

// ── Main page ────────────────────────────────────────────────────

export function ReposPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [teamFilter, setTeamFilter] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [abandonedFilter, setAbandonedFilter] = useState<'all' | 'abandoned' | 'active'>('all');
  const [sourceFilter, setSourceFilter] = useState<number[]>([]);
  const [languageFilter, setLanguageFilter] = useState<string[]>([]);
  const [sizeFilter, setSizeFilter] = useState<{ min?: number; max?: number } | null>(null);
  const [riskScoreFilter, setRiskScoreFilter] = useState<{ min?: number; max?: number } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(loadVisibleColumns);
  const [showColumnSettings, setShowColumnSettings] = useState(false);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(COL_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const isColVisible = (key: ColumnKey) => visibleColumns.has(key);

  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();
  const wsRole = useCurrentWorkspaceRole();
  const canEdit = user ? canWrite(user.role, wsRole ?? undefined) : false;
  const { data: allRepos, isLoading } = useRepositories();
  const { data: teams } = useTeams();
  const { data: sources } = useSources();
  const queryClient = useQueryClient();
  const bulkUpdate = useBulkUpdateRepositories();

  const teamMap = new Map(teams?.map((t) => [t.id, t.name]) ?? []);
  const sourceMap = new Map(sources?.map((s) => [s.id, s]) ?? []);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(0);
  };

  const filtered = useMemo(() => {
    let repos = allRepos ?? [];
    if (search) {
      const q = search.toLowerCase();
      repos = repos.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (teamFilter.length > 0) {
      const set = new Set(teamFilter);
      repos = repos.filter((r) => set.has(r.teamId));
    }
    // Status filter: empty = all except ignored, array = match any
    if (statusFilter.length === 0) {
      repos = repos.filter((r) => (r.status ?? 'pending') !== 'ignored');
    } else {
      const set = new Set(statusFilter);
      repos = repos.filter((r) => set.has(r.status ?? 'pending'));
    }
    if (abandonedFilter === 'abandoned') {
      repos = repos.filter((r) => isAbandoned(r.lastActivityAt));
    } else if (abandonedFilter === 'active') {
      repos = repos.filter((r) => !isAbandoned(r.lastActivityAt));
    }
    if (sourceFilter.length > 0) {
      const set = new Set(sourceFilter);
      repos = repos.filter((r) => r.sourceId != null && set.has(r.sourceId));
    }
    if (languageFilter.length > 0) {
      const set = new Set(languageFilter);
      repos = repos.filter((r) => r.primaryLanguage != null && set.has(r.primaryLanguage));
    }
    if (sizeFilter) {
      repos = repos.filter((r) => {
        const sz = r.sizeBytes ?? 0;
        if (sizeFilter.min != null && sz < sizeFilter.min) return false;
        if (sizeFilter.max != null && sz > sizeFilter.max) return false;
        return true;
      });
    }
    if (riskScoreFilter) {
      repos = repos.filter((r) => {
        const rs = r.riskScore ?? 0;
        if (riskScoreFilter.min != null && rs < riskScoreFilter.min) return false;
        if (riskScoreFilter.max != null && rs > riskScoreFilter.max) return false;
        return true;
      });
    }
    // Sort
    if (sortField) {
      repos = [...repos].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
          case 'name': cmp = a.name.localeCompare(b.name); break;
          case 'status': cmp = (a.status ?? '').localeCompare(b.status ?? ''); break;
          case 'team': cmp = (teamMap.get(a.teamId) ?? '').localeCompare(teamMap.get(b.teamId) ?? ''); break;
          case 'source': {
            const sa = sourceMap.get(a.sourceId!)?.orgName ?? '';
            const sb = sourceMap.get(b.sourceId!)?.orgName ?? '';
            cmp = sa.localeCompare(sb);
            break;
          }
          case 'language': cmp = (a.primaryLanguage ?? '').localeCompare(b.primaryLanguage ?? ''); break;
          case 'size': cmp = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0); break;
          case 'abandoned': {
            const aa = isAbandoned(a.lastActivityAt) ? 1 : 0;
            const ab = isAbandoned(b.lastActivityAt) ? 1 : 0;
            cmp = aa - ab;
            break;
          }
          case 'riskScore': cmp = (a.riskScore ?? 0) - (b.riskScore ?? 0); break;
          case 'findingsCount': cmp = (a.findingsCount ?? 0) - (b.findingsCount ?? 0); break;
          case 'lastScannedAt': cmp = (a.lastScannedAt ?? '').localeCompare(b.lastScannedAt ?? ''); break;
          case 'updatedAt': cmp = (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''); break;
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return repos;
  }, [allRepos, search, teamFilter, statusFilter, abandonedFilter, sourceFilter, languageFilter, sizeFilter, riskScoreFilter, sortField, sortDir, teamMap]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRepos = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageIds = new Set(pageRepos.map((r) => r.id));
  const allPageSelected = pageRepos.length > 0 && pageRepos.every((r) => selected.has(r.id));

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(filtered.map((r) => r.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  // ── Chip filter definitions ─────────────────────────────────
  const statusOptions = [
    { value: 'pending', label: t('repos.statusPending') },
    { value: 'queued', label: t('repos.statusQueued') },
    { value: 'analyzing', label: t('repos.statusAnalyzing') },
    { value: 'completed', label: t('repos.statusCompleted') },
    { value: 'failed', label: t('repos.statusFailed') },
    { value: 'ignored', label: t('repos.statusIgnored') },
  ];

  const abandonedOptions = [
    { value: 'active', label: t('repos.hideAbandoned') },
    { value: 'abandoned', label: t('repos.showAbandoned') },
  ];

  const teamOptions = (teams ?? []).map((tm) => ({
    value: String(tm.id),
    label: tm.name,
  }));

  const sourceOptions = (sources ?? []).map((s) => ({
    value: String(s.id),
    label: s.orgName ?? s.provider,
  }));

  const languageOptions = useMemo(() => {
    const langs = new Set<string>();
    for (const r of allRepos ?? []) {
      if (r.primaryLanguage) langs.add(r.primaryLanguage);
    }
    return Array.from(langs).sort().map((l) => ({ value: l, label: l }));
  }, [allRepos]);

  const filterColumns: FilterColumn[] = [
    ...(teamOptions.length > 0 ? [{ key: 'team', label: t('repos.team'), multi: true, options: teamOptions }] : []),
    { key: 'status', label: t('repos.statusFilter'), multi: true, options: statusOptions },
    ...(sourceOptions.length > 0 ? [{ key: 'source', label: t('repos.source'), multi: true, options: sourceOptions }] : []),
    ...(languageOptions.length > 0 ? [{ key: 'language', label: t('repos.language'), multi: true, options: languageOptions }] : []),
    { key: 'size', label: t('repos.size'), type: 'range' as const, options: [], minPlaceholder: t('repos.sizeMin'), maxPlaceholder: t('repos.sizeMax') },
    { key: 'riskScore', label: t('repos.riskScore'), type: 'range' as const, options: [], minPlaceholder: '0', maxPlaceholder: '10' },
    { key: 'abandoned', label: t('repos.maintained'), options: abandonedOptions },
  ];

  const chipFilters: ActiveFilter[] = [];
  if (teamFilter.length > 0) {
    const labels = teamFilter.map((id) => teams?.find((x) => x.id === id)?.name ?? '').filter(Boolean);
    chipFilters.push({ key: 'team', value: teamFilter.map(String).join(','), label: labels.join(', '), columnLabel: t('repos.team') });
  }
  if (statusFilter.length > 0) {
    const labels = statusFilter.map((v) => statusOptions.find((o) => o.value === v)?.label ?? v);
    chipFilters.push({ key: 'status', value: statusFilter.join(','), label: labels.join(', '), columnLabel: t('repos.statusFilter') });
  }
  if (sourceFilter.length > 0) {
    const labels = sourceFilter.map((id) => { const s = sources?.find((x) => x.id === id); return s?.orgName ?? s?.provider ?? ''; }).filter(Boolean);
    chipFilters.push({ key: 'source', value: sourceFilter.map(String).join(','), label: labels.join(', '), columnLabel: t('repos.source') });
  }
  if (languageFilter.length > 0) {
    chipFilters.push({ key: 'language', value: languageFilter.join(','), label: languageFilter.join(', '), columnLabel: t('repos.language') });
  }
  if (sizeFilter) {
    const label = formatRangeLabel(sizeFilter.min, sizeFilter.max, formatBytes);
    chipFilters.push({ key: 'size', value: `${sizeFilter.min ?? ''}..${sizeFilter.max ?? ''}`, label, columnLabel: t('repos.size') });
  }
  if (riskScoreFilter) {
    const label = formatRangeLabel(riskScoreFilter.min, riskScoreFilter.max, String);
    chipFilters.push({ key: 'riskScore', value: `${riskScoreFilter.min ?? ''}..${riskScoreFilter.max ?? ''}`, label, columnLabel: t('repos.riskScore') });
  }
  if (abandonedFilter !== 'all') {
    const opt = abandonedOptions.find((o) => o.value === abandonedFilter);
    chipFilters.push({ key: 'abandoned', value: abandonedFilter, label: opt?.label ?? abandonedFilter, columnLabel: t('repos.maintained') });
  }

  const handleFilterAdd = (columnKey: string, value: string) => {
    setPage(0);
    if (columnKey === 'team') setTeamFilter(value.split(',').map(Number));
    else if (columnKey === 'status') setStatusFilter(value.split(','));
    else if (columnKey === 'source') setSourceFilter(value.split(',').map(Number));
    else if (columnKey === 'language') setLanguageFilter(value.split(','));
    else if (columnKey === 'size') {
      const [minStr, maxStr] = value.split('..');
      setSizeFilter({ min: parseSizeInput(minStr), max: parseSizeInput(maxStr) });
    }
    else if (columnKey === 'riskScore') {
      const [minStr, maxStr] = value.split('..');
      setRiskScoreFilter({
        min: minStr ? Number(minStr) : undefined,
        max: maxStr ? Number(maxStr) : undefined,
      });
    }
    else if (columnKey === 'abandoned') setAbandonedFilter(value as 'abandoned' | 'active');
  };

  const handleFilterRemove = (columnKey: string) => {
    setPage(0);
    if (columnKey === 'team') setTeamFilter([]);
    else if (columnKey === 'status') setStatusFilter([]);
    else if (columnKey === 'source') setSourceFilter([]);
    else if (columnKey === 'language') setLanguageFilter([]);
    else if (columnKey === 'size') setSizeFilter(null);
    else if (columnKey === 'riskScore') setRiskScoreFilter(null);
    else if (columnKey === 'abandoned') setAbandonedFilter('all');
  };

  // ── Bulk actions ───────────────────────────────────────────

  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const triggerScan = useTriggerScan();

  const bulkScan = async () => {
    if (selected.size === 0) return;
    setBulkLoading('scan');

    const repos = (allRepos ?? []).filter((r) => selected.has(r.id));
    for (const repo of repos) {
      await triggerScan.mutateAsync(buildScanBody(repo));
    }

    clearSelection();
    setBulkLoading(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} repositories and all their data? This cannot be undone.`)) return;
    setBulkLoading('delete');

    for (const id of selected) {
      await apiFetch(`/api/repositories/${id}`, {
        method: 'DELETE',
      });
    }

    queryClient.invalidateQueries({ queryKey: ['repositories'] });
    queryClient.invalidateQueries({ queryKey: ['teams'] });
    clearSelection();
    setBulkLoading(null);
  };

  const bulkAssignTeam = (teamId: number) => {
    if (selected.size === 0) return;
    setBulkLoading('assign');
    bulkUpdate.mutate(
      { ids: Array.from(selected), team_id: teamId },
      {
        onSettled: () => {
          setBulkLoading(null);
          setShowTeamDropdown(false);
          clearSelection();
        },
      },
    );
  };

  const fetchRepoFindings = async (repoId: number, severities: string[], tools: string[], statuses: string[]): Promise<Finding[]> => {
    const wsId = currentWorkspace?.id;
    let allFindings: Finding[] = [];
    let offset = 0;
    const limit = 500;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const params = new URLSearchParams({
        workspace_id: String(wsId),
        repository_id: String(repoId),
        status: statuses.join(','),
        severity: severities.join(','),
        tool: tools.join(','),
        limit: String(limit),
        offset: String(offset),
        sort: 'severity',
        dir: 'asc',
        include_secrets: 'true',
      });
      const page = await fetchApi<{ count: number; results: Finding[] }>(`/api/findings?${params}`);
      allFindings = allFindings.concat(page.results);
      if (allFindings.length >= page.count) break;
      offset += limit;
    }

    return allFindings;
  };

  // Collect tool counts scoped to selected repos (for export dialog)
  const selectedRepoIds = useMemo(() => [...selected], [selected]);
  const { data: toolCounts } = useFindingCountsByTool(
    selectedRepoIds.length > 0 ? selectedRepoIds : undefined,
  );

  const handleExport = async (severities: string[], tools: string[], statuses: string[], format: ExportFormat) => {
    setShowExportDialog(false);
    if (selected.size === 0) return;
    setBulkLoading('export');

    const isCsv = format === 'csv';
    const ext = isCsv ? 'csv' : 'md';
    const mime = isCsv ? 'text/csv' : 'text/markdown';
    const repos = (allRepos ?? []).filter((r) => selected.has(r.id));

    const generateContent = (repoName: string, findings: ExportFinding[]) =>
      isCsv ? generateFindingsCsv(findings) : generateFindingsMarkdown(repoName, findings);

    if (repos.length === 1) {
      const repo = repos[0];
      const findings = await fetchRepoFindings(repo.id, severities, tools, statuses);
      const content = generateContent(repo.name, findings as ExportFinding[]);
      const safeName = repo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      downloadFile(`${safeName}-findings.${ext}`, content, mime);
    } else {
      const files: { name: string; content: string }[] = [];
      for (const repo of repos) {
        const findings = await fetchRepoFindings(repo.id, severities, tools, statuses);
        const content = generateContent(repo.name, findings as ExportFinding[]);
        const safeName = repo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        files.push({ name: `${safeName}-findings.${ext}`, content });
      }
      const date = new Date().toISOString().slice(0, 10);
      await downloadAsZip(files, `findings-export-${date}.zip`);
    }

    clearSelection();
    setBulkLoading(null);
  };

  const scanOne = async (repoId: number) => {
    const repo = allRepos?.find((r) => r.id === repoId);
    if (!repo) return;
    await triggerScan.mutateAsync(buildScanBody(repo));
  };

  return (
    <ErrorBoundary>
      <div className="beast-stack">
        <div className="beast-page-header">
          <div>
            <h1 className="beast-page-title">{t('repos.title')}</h1>
            <p className="beast-page-subtitle">
              {allRepos ? `${filtered.length} repositories` : 'All scanned repositories'}
            </p>
          </div>
          {canEdit && (
            <Link
              to="/settings#sources"
              className="beast-btn beast-btn-primary"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('repos.addRepo')}
            </Link>
          )}
        </div>

        {/* Chip filter bar */}
        <div className="beast-filter-row">
          <div className="beast-chip-filter-wrap">
            <ChipFilter
              columns={filterColumns}
              activeFilters={chipFilters}
              onAdd={handleFilterAdd}
              onRemove={handleFilterRemove}
              searchValue={search}
              onSearchChange={handleSearchChange}
              searchPlaceholder={t('repos.searchPlaceholder')}
            />
          </div>

          {/* Column settings */}
          <div className="beast-dropdown-wrap">
            <button
              type="button"
              title={t('repos.columnSettings')}
              onClick={() => setShowColumnSettings(!showColumnSettings)}
              className="beast-btn beast-btn-outline beast-btn-filter"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {showColumnSettings && (
              <ColumnSettingsDropdown
                visible={visibleColumns}
                onToggle={toggleColumn}
                onClose={() => setShowColumnSettings(false)}
              />
            )}
          </div>
        </div>

        {/* Bulk actions bar */}
        {selected.size > 0 && canEdit && (
          <div className="beast-card beast-bulk-bar">
            {/* Selection info */}
            <span className="beast-bulk-bar-count">
              {selected.size} {t('common.selected')}
            </span>
            {selected.size < filtered.length && (
              <button onClick={selectAll} className="beast-btn beast-btn-ghost beast-btn-sm">
                {t('common.all')} {filtered.length}
              </button>
            )}
            <button onClick={clearSelection} className="beast-btn beast-btn-ghost beast-btn-sm">
              {t('common.clear')}
            </button>

            <div className="beast-divider-v" />

            {/* Actions */}
            <div className="beast-bulk-bar-actions">
              <button
                onClick={bulkScan}
                disabled={!!bulkLoading}
                className="beast-btn beast-btn-primary beast-btn-sm"
              >
                {bulkLoading === 'scan' ? t('repos.queuingScans') : `${t('repos.scanSelected')} (${selected.size})`}
              </button>

              <div className="beast-dropdown-wrap">
                <button
                  onClick={() => setShowTeamDropdown(!showTeamDropdown)}
                  disabled={!!bulkLoading}
                  className="beast-btn beast-btn-outline beast-btn-sm"
                >
                  {bulkLoading === 'assign' ? t('repos.assigning') : t('repos.assignToTeam')}
                </button>
                {showTeamDropdown && (
                  <TeamAssignDropdown
                    teams={teams ?? []}
                    onAssign={bulkAssignTeam}
                    isAssigning={bulkLoading === 'assign'}
                    onClose={() => setShowTeamDropdown(false)}
                  />
                )}
              </div>

              <button
                onClick={() => setShowExportDialog(true)}
                disabled={!!bulkLoading}
                className="beast-btn beast-btn-outline beast-btn-sm"
              >
                {bulkLoading === 'export' ? t('repos.exporting') : `${t('repos.exportFindings')} (${selected.size})`}
              </button>
            </div>

            <div className="beast-flex-1" />

            {/* Destructive */}
            <button
              onClick={bulkDelete}
              disabled={!!bulkLoading}
              className="beast-btn beast-btn-danger beast-btn-sm"
            >
              {bulkLoading === 'delete' ? t('repos.deletingRepos') : `${t('repos.deleteSelected')} (${selected.size})`}
            </button>
          </div>
        )}

        {/* Table */}
        <div className="beast-table-wrap">
          {isLoading ? (
            <div className="beast-section-pad"><TableSkeleton rows={8} /></div>
          ) : !pageRepos.length ? (
            <EmptyState
              title={search ? t('repos.noMatchingRepos') : t('repos.noReposFound')}
              description={search ? t('repos.tryDifferentSearch') : t('repos.reposAfterScanning')}
            />
          ) : (
            <>
              <table className="beast-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={togglePage}
                        className="beast-checkbox"
                      />
                    </th>
                    <SortableHeader field="name" label={t('repos.repository')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    {isColVisible('status') && <SortableHeader field="status" label={t('repos.statusFilter')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isColVisible('team') && <SortableHeader field="team" label={t('repos.team')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isColVisible('source') && <SortableHeader field="source" label={t('repos.source')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isColVisible('language') && <SortableHeader field="language" label={t('repos.language')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isColVisible('size') && <SortableHeader field="size" label={t('repos.size')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />}
                    {isColVisible('abandoned') && <SortableHeader field="abandoned" label={t('repos.maintained')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isColVisible('riskScore') && <SortableHeader field="riskScore" label={t('repos.riskScore')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />}
                    {isColVisible('findingsCount') && <SortableHeader field="findingsCount" label={t('repos.findingsCol')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />}
                    {isColVisible('lastScannedAt') && <SortableHeader field="lastScannedAt" label={t('repos.lastScanned')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />}
                    {isColVisible('updatedAt') && <SortableHeader field="updatedAt" label={t('repos.lastUpdated')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />}
                    <th className="beast-th-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRepos.map((repo) => (
                    <RepoRow
                      key={repo.id}
                      repo={repo}
                      teamName={teamMap.get(repo.teamId)}
                      source={repo.sourceId ? sourceMap.get(repo.sourceId) : undefined}
                      isSelected={selected.has(repo.id)}
                      onToggle={() => toggleOne(repo.id)}
                      onScan={() => scanOne(repo.id)}
                      visibleColumns={visibleColumns}
                      canEdit={canEdit}
                    />
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>

      <ExportDialog
        open={showExportDialog}
        repoCount={selected.size}
        toolCounts={toolCounts ?? []}
        onExport={handleExport}
        onCancel={() => setShowExportDialog(false)}
      />
    </ErrorBoundary>
  );
}

function RepoRow({
  repo,
  teamName,
  source,
  isSelected,
  onToggle,
  onScan,
  visibleColumns,
  canEdit,
}: {
  repo: Repository;
  teamName?: string;
  source?: { provider: string; orgName: string | null };
  isSelected: boolean;
  onToggle: () => void;
  onScan: () => void;
  visibleColumns: Set<ColumnKey>;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const isActive = repo.status === 'queued' || repo.status === 'analyzing';

  const handleScan = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await onScan();
    } catch (err) {
      console.error('[scan] Failed:', err instanceof Error ? err.message : err);
    }
  };

  return (
    <tr className={cn(
      isSelected && 'bg-beast-red/5',
      repo.status === 'ignored' && 'opacity-60',
    )}>
      <td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="beast-checkbox"
        />
      </td>
      <td className="beast-td-primary">
        <Link to={`/repos/${repo.id}`} className="beast-td-primary beast-link">
          {repo.name}
        </Link>
        {repo.tags.length > 0 && (
          <div className="beast-tag-row">
            {repo.tags.slice(0, 3).map((t) => (
              <span key={t} className="beast-badge beast-badge-gray">{t}</span>
            ))}
          </div>
        )}
      </td>
      {visibleColumns.has('status') && (
        <td>
          <RepoStatusBadge status={repo.status ?? 'pending'} />
        </td>
      )}
      {visibleColumns.has('team') && (
        <td>
          {teamName ?? '\u2014'}
        </td>
      )}
      {visibleColumns.has('source') && (
        <td>
          {source ? (
            <span className="beast-source-inline">
              <ProviderIcon provider={source.provider} className="beast-source-inline-icon" />
              {source.orgName ?? source.provider}
            </span>
          ) : '\u2014'}
        </td>
      )}
      {visibleColumns.has('language') && (
        <td>
          {repo.primaryLanguage ? (
            <span className="beast-badge beast-badge-blue">
              {repo.primaryLanguage}
            </span>
          ) : (
            <span>{'\u2014'}</span>
          )}
        </td>
      )}
      {visibleColumns.has('size') && (
        <td className="beast-td-date">
          {formatBytes(repo.sizeBytes)}
        </td>
      )}
      {visibleColumns.has('abandoned') && (
        <td className="text-center">
          {repo.lastActivityAt ? (
            isAbandoned(repo.lastActivityAt) ? (
              <span className="beast-maintained-dot beast-maintained-no" title={t('repos.maintainedNo')} />
            ) : (
              <span className="beast-maintained-dot beast-maintained-yes" title={t('repos.maintainedYes')} />
            )
          ) : (
            <span>{'\u2014'}</span>
          )}
        </td>
      )}
      {visibleColumns.has('riskScore') && (
        <td className="beast-td-numeric">
          <RiskScoreBadge score={repo.riskScore ?? 0} />
        </td>
      )}
      {visibleColumns.has('findingsCount') && (
        <td className="beast-td-numeric">
          {repo.findingsCount ?? 0}
        </td>
      )}
      {visibleColumns.has('lastScannedAt') && (
        <td className="beast-td-date">
          {repo.lastScannedAt
            ? formatDate(repo.lastScannedAt)
            : '\u2014'}
        </td>
      )}
      {visibleColumns.has('updatedAt') && (
        <td className="beast-td-date">
          {repo.lastActivityAt
            ? formatDate(repo.lastActivityAt)
            : '\u2014'}
        </td>
      )}
      <td className="beast-td-action">
        {canEdit && (
          <button
            onClick={handleScan}
            disabled={isActive}
            title={t('repos.triggerScan')}
            className={cn(
              'beast-btn beast-btn-sm',
              isActive
                ? 'beast-btn-outline cursor-not-allowed'
                : 'beast-btn-outline',
            )}
          >
            {isActive ? (
              <span className="beast-flex beast-flex-gap-xs">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {repo.status === 'queued' ? t('repos.queued') : t('repos.statusAnalyzing')}
              </span>
            ) : t('repos.scan')}
          </button>
        )}
      </td>
    </tr>
  );
}
