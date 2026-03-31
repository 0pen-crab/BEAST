import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { useFindings, useRepositories } from '@/api/hooks';
import { SeverityBadge } from '@/components/severity-badge';
import { StatusBadge } from '@/components/status-badge';
import { ChipFilter, type FilterColumn, type ActiveFilter } from '@/components/filters/chip-filter';
import { Pagination } from '@/components/pagination';
import { TableSkeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { ErrorBoundary } from '@/components/error-boundary';
import { TOOLS } from '@/lib/tool-mapping';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/lib/format';
import { SEVERITIES, STATUSES } from '@/api/types';
import type { Severity, Status, Finding } from '@/api/types';

const PAGE_SIZE = 50;

/** Show only the filename (last path segment) + line number */
function shortPath(filePath: string, line: number | null | undefined): string {
  let clean = filePath.replace(/^file:\/\/\/workspace\/[^/]+\/repo\//, '');
  const parts = clean.split('/');
  if (parts.length > 2) {
    clean = parts.slice(-2).join('/');
  }
  return line != null ? `${clean}:${line}` : clean;
}

// ── Sortable header ──────────────────────────────────────────────

type SortField = 'title' | 'severity' | 'tool' | 'status' | 'cvss_score' | 'created_at' | 'repository' | 'contributor' | 'file_path';
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
          active && (sortDir === 'asc' ? 'sort-asc' : 'sort-desc'),
        )}
      >
        {label}
        <span className="beast-sort-icon">
          <span className="beast-sort-icon-up" />
          <span className="beast-sort-icon-down" />
        </span>
      </button>
    </th>
  );
}

// ── Column visibility ────────────────────────────────────────────

type ColumnKey = 'severity' | 'tool' | 'location' | 'repository' | 'contributor' | 'cvss' | 'status' | 'date';

const COLUMNS: { key: ColumnKey; labelKey: string; align?: 'right' }[] = [
  { key: 'severity', labelKey: 'findings.severity' },
  { key: 'tool', labelKey: 'findings.tool' },
  { key: 'location', labelKey: 'findings.location' },
  { key: 'repository', labelKey: 'findings.repository' },
  { key: 'contributor', labelKey: 'findings.contributor' },
  { key: 'cvss', labelKey: 'findings.cvss', align: 'right' },
  { key: 'status', labelKey: 'findings.status' },
  { key: 'date', labelKey: 'findings.date', align: 'right' },
];

const DEFAULT_VISIBLE: ColumnKey[] = ['severity', 'tool', 'location', 'repository', 'contributor', 'status', 'date'];

const COL_KEY = 'beast_finding_columns';

function loadVisibleColumns(): Set<ColumnKey> {
  try {
    const stored = localStorage.getItem(COL_KEY);
    if (stored) return new Set(JSON.parse(stored) as ColumnKey[]);
  } catch (err) {
    console.error('[findings] Failed to parse stored column settings:', err);
  }
  return new Set(DEFAULT_VISIBLE);
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
    <div ref={ref} className="beast-dropdown">
      {COLUMNS.map((col) => (
        <label key={col.key} className="beast-dropdown-item" aria-label={t(col.labelKey)}>
          <input
            type="checkbox"
            checked={visible.has(col.key)}
            onChange={() => onToggle(col.key)}
            className="beast-checkbox"
            aria-label={t(col.labelKey)}
          />
          {t(col.labelKey)}
        </label>
      ))}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────

export function FindingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [repoFilter, setRepoFilter] = useState<number | null>(() => {
    const r = searchParams.get('repository');
    return r ? Number(r) : null;
  });
  const [toolFilter, setToolFilter] = useState<string[]>(() => {
    const t = searchParams.get('tool');
    return t ? t.split(',') : [];
  });
  const [showDuplicates, setShowDuplicates] = useState<'yes' | 'no' | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(loadVisibleColumns);
  const [showColumnSettings, setShowColumnSettings] = useState(false);

  const { data: repos } = useRepositories();
  const repoMap = new Map(repos?.map((r) => [r.id, r.name]) ?? []);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(0);
  };

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(COL_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const isCol = (key: ColumnKey) => visibleColumns.has(key);

  // Build API query params
  const findingParams: Record<string, string | number | boolean | undefined> = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  if (showDuplicates === 'yes') { /* show all */ }
  else { findingParams.duplicate = false; }

  if (repoFilter !== null) findingParams.repository_id = repoFilter;
  if (severityFilter.length > 0) findingParams.severity = severityFilter.join(',');
  if (toolFilter.length > 0) findingParams.tool = toolFilter.join(',');
  if (statusFilter.length > 0) {
    // Map display names to API values
    const apiStatuses = statusFilter.map((s) => {
      if (s === 'Open') return 'open';
      if (s === 'Risk Accepted') return 'risk_accepted';
      if (s === 'False Positive') return 'false_positive';
      if (s === 'Fixed') return 'fixed';
      if (s === 'Duplicate') return 'duplicate';
      return s;
    });
    findingParams.status = apiStatuses.join(',');
  }

  if (sortField) {
    findingParams.sort = sortField;
    findingParams.dir = sortDir;
  }

  const { data: findings, isLoading } = useFindings(
    findingParams as Parameters<typeof useFindings>[0],
  );

  const totalPages = findings ? Math.ceil(findings.count / PAGE_SIZE) : 0;

  // ── ChipFilter config ──────────────────────────────────────
  const severityOptions = SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`) }));
  const statusOptions = STATUSES.map((s) => ({ value: s, label: t(`status.${s.replace(/\s+/g, '')}`) }));
  const repoOptions = (repos ?? []).map((r) => ({ value: String(r.id), label: r.name }));
  const toolOptions = TOOLS.map((tool) => ({ value: tool.key, label: tool.displayName }));
  const duplicateOptions = [
    { value: 'yes', label: t('findings.showDuplicates', 'Show duplicates') },
    { value: 'no', label: t('findings.hideDuplicates', 'Hide duplicates') },
  ];

  const filterColumns: FilterColumn[] = [
    { key: 'severity', label: t('findings.severity'), multi: true, options: severityOptions },
    { key: 'status', label: t('findings.status'), multi: true, options: statusOptions },
    { key: 'tool', label: t('findings.tool'), multi: true, options: toolOptions },
    ...(repoOptions.length > 0
      ? [{ key: 'repository', label: t('findings.repository'), options: repoOptions }]
      : []),
    { key: 'duplicates', label: t('findings.duplicates', 'Duplicates'), options: duplicateOptions },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (severityFilter.length > 0) {
    const labels = severityFilter.map((s) => t(`severity.${s}`));
    activeFilters.push({ key: 'severity', value: severityFilter.join(','), label: labels.join(', '), columnLabel: t('findings.severity') });
  }
  if (statusFilter.length > 0) {
    const labels = statusFilter.map((s) => t(`status.${s.replace(/\s+/g, '')}`));
    activeFilters.push({ key: 'status', value: statusFilter.join(','), label: labels.join(', '), columnLabel: t('findings.status') });
  }
  if (toolFilter.length > 0) {
    const labels = toolFilter.map((k) => TOOLS.find((tl) => tl.key === k)?.displayName ?? k);
    activeFilters.push({ key: 'tool', value: toolFilter.join(','), label: labels.join(', '), columnLabel: t('findings.tool') });
  }
  if (repoFilter !== null) {
    const repo = repos?.find((r) => r.id === repoFilter);
    activeFilters.push({ key: 'repository', value: String(repoFilter), label: repo?.name ?? '', columnLabel: t('findings.repository') });
  }
  if (showDuplicates !== null) {
    const opt = duplicateOptions.find((o) => o.value === showDuplicates);
    activeFilters.push({ key: 'duplicates', value: showDuplicates, label: opt?.label ?? '', columnLabel: t('findings.duplicates', 'Duplicates') });
  }

  const handleFilterAdd = (columnKey: string, value: string) => {
    setPage(0);
    if (columnKey === 'severity') setSeverityFilter(value.split(','));
    else if (columnKey === 'status') setStatusFilter(value.split(','));
    else if (columnKey === 'tool') {
      const vals = value.split(',');
      setToolFilter(vals);
      setSearchParams((p) => { p.set('tool', value); return p; }, { replace: true });
    }
    else if (columnKey === 'repository') {
      setRepoFilter(Number(value));
      setSearchParams((p) => { p.set('repository', value); return p; }, { replace: true });
    }
    else if (columnKey === 'duplicates') setShowDuplicates(value as 'yes' | 'no');
  };

  const handleFilterRemove = (columnKey: string) => {
    setPage(0);
    if (columnKey === 'severity') setSeverityFilter([]);
    else if (columnKey === 'status') setStatusFilter([]);
    else if (columnKey === 'tool') {
      setToolFilter([]);
      setSearchParams((p) => { p.delete('tool'); return p; }, { replace: true });
    }
    else if (columnKey === 'repository') {
      setRepoFilter(null);
      setSearchParams((p) => { p.delete('repository'); return p; }, { replace: true });
    }
    else if (columnKey === 'duplicates') setShowDuplicates(null);
  };

  // Client-side search (title + filePath)
  const displayResults = findings?.results.filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return f.title.toLowerCase().includes(q) || (f.filePath?.toLowerCase().includes(q));
  });

  return (
    <ErrorBoundary>
      <div className="beast-stack">
        <div className="beast-page-header">
          <div>
            <h1 className="beast-page-title">{t('findings.title')}</h1>
            <p className="beast-page-subtitle">{t('findings.subtitle')}</p>
          </div>
          {findings && (
            <span className="beast-pagination-info">{findings.count} {t('common.results')}</span>
          )}
        </div>

        {/* Chip filter bar + column settings */}
        <div className="beast-filter-row">
          <div className="beast-chip-filter-wrap">
            <ChipFilter
              columns={filterColumns}
              activeFilters={activeFilters}
              onAdd={handleFilterAdd}
              onRemove={handleFilterRemove}
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder={t('findings.searchPlaceholder')}
            />
          </div>

          {/* Column settings */}
          <div className="beast-dropdown-wrap">
            <button
              type="button"
              title={t('findings.columnSettings')}
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

        {/* Table */}
        {isLoading ? (
          <TableSkeleton rows={12} />
        ) : !displayResults?.length ? (
          <EmptyState title={t('findings.noFindings')} description={t('findings.noFindingsMatch')} />
        ) : (
          <>
            <div className="beast-table-wrap">
              <table className="beast-table">
                <thead>
                  <tr>
                    <SortableHeader field="title" label={t('findings.finding')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    {isCol('severity') && <SortableHeader field="severity" label={t('findings.severity')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isCol('tool') && <SortableHeader field="tool" label={t('findings.tool')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isCol('location') && <SortableHeader field="file_path" label={t('findings.location')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isCol('repository') && <SortableHeader field="repository" label={t('findings.repository')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isCol('contributor') && <SortableHeader field="contributor" label={t('findings.contributor')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isCol('cvss') && <SortableHeader field="cvss_score" label={t('findings.cvss')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />}
                    {isCol('status') && <SortableHeader field="status" label={t('findings.status')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />}
                    {isCol('date') && <SortableHeader field="created_at" label={t('findings.date')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />}
                  </tr>
                </thead>
                <tbody>
                  {displayResults.map((finding) => (
                    <FindingRow
                      key={finding.id}
                      finding={finding}
                      visibleColumns={visibleColumns}
                      repoMap={repoMap}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </div>
    </ErrorBoundary>
  );
}

// ── Finding row ──────────────────────────────────────────────────

function FindingRow({
  finding,
  visibleColumns,
  repoMap,
}: {
  finding: Finding;
  visibleColumns: Set<ColumnKey>;
  repoMap: Map<number, string>;
}) {
  const toolMeta = TOOLS.find((t) => t.key === finding.tool);
  const repoName = finding.repositoryId ? repoMap.get(finding.repositoryId) : null;

  return (
    <tr className={cn(finding.status !== 'open' && 'beast-row-dimmed')}>
      <td className="beast-td-primary">
        <Link to={`/findings/${finding.id}`} className="beast-td-primary beast-link-red">
          {finding.title}
        </Link>
      </td>
      {visibleColumns.has('severity') && (
        <td><SeverityBadge severity={finding.severity} /></td>
      )}
      {visibleColumns.has('tool') && (
        <td>{toolMeta?.displayName ?? finding.tool}</td>
      )}
      {visibleColumns.has('location') && (
        <td>
          {finding.filePath ? (
            <code className="beast-td-code" title={finding.filePath}>
              {shortPath(finding.filePath, finding.line)}
            </code>
          ) : <span>&mdash;</span>}
        </td>
      )}
      {visibleColumns.has('repository') && (
        <td>
          {repoName ? (
            <Link to={`/repos/${finding.repositoryId}`} className="beast-link">
              {repoName}
            </Link>
          ) : '\u2014'}
        </td>
      )}
      {visibleColumns.has('contributor') && (
        <td>
          {finding.contributorName ? (
            finding.contributorId ? (
              <Link to={`/contributors/${finding.contributorId}`} className="beast-link">
                {finding.contributorName}
              </Link>
            ) : finding.contributorName
          ) : '\u2014'}
        </td>
      )}
      {visibleColumns.has('cvss') && (
        <td className="beast-td-numeric">
          {finding.cvssScore != null ? finding.cvssScore.toFixed(1) : '\u2014'}
        </td>
      )}
      {visibleColumns.has('status') && (
        <td><StatusBadge finding={finding} /></td>
      )}
      {visibleColumns.has('date') && (
        <td className="beast-td-date">{formatDateShort(finding.createdAt)}</td>
      )}
    </tr>
  );
}
