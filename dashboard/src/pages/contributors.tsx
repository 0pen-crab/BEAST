import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useContributors, useTeams, useBulkUpdateContributors, useMergeContributors } from '@/api/hooks';
import { useWorkspace } from '@/lib/workspace';
import { ErrorBoundary } from '@/components/error-boundary';
import { MergeContributorModal } from '@/components/merge-contributor-modal';
import { TableSkeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { Contributor } from '@/api/contributor-types';

const PAGE_SIZE = 25;

// ── Score badge ──────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="beast-page-subtitle">&mdash;</span>;
  }
  const rounded = Math.round(score * 10) / 10;
  return (
    <span
      className={cn(
        'beast-score',
        rounded >= 7
          ? 'beast-score-good'
          : rounded >= 5
            ? 'beast-score-mid'
            : 'beast-score-bad',
      )}
    >
      {rounded.toFixed(1)}
    </span>
  );
}

// ── Format LOC ──────────────────────────────────────────────────

function formatLOC(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── Search icon ─────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg className="beast-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M9.5 9.5L12.5 12.5" />
    </svg>
  );
}

// ── Team assign dropdown ────────────────────────────────────────

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

type SortField = 'displayName' | 'team' | 'scoreOverall' | 'scoreSecurity' | 'scoreQuality' | 'repoCount' | 'totalCommits' | 'loc' | 'lastSeen';
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
  align?: 'right' | 'center';
}) {
  const active = sortField === field;
  return (
    <th className={cn(align === 'right' && 'beast-th-right', align === 'center' && 'text-center')}>
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

export function ContributorsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<SortField | null>('scoreOverall');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [teamFilter, setTeamFilter] = useState<number | 'all'>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);

  const { currentWorkspace } = useWorkspace();
  const { data, isLoading } = useContributors({
    limit: 200,
    offset: 0,
    sort: 'score_overall',
    dir: 'desc',
  });
  const { data: teams } = useTeams();
  const bulkUpdate = useBulkUpdateContributors();
  const mergeMutation = useMergeContributors();

  const teamMap = new Map(teams?.map((tm) => [tm.id, tm.name]) ?? []);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'displayName' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  const allContributors = data?.results ?? [];

  const filtered = useMemo(() => {
    let list = allContributors;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.emails.some((e) => e.toLowerCase().includes(q)),
      );
    }

    if (teamFilter !== 'all') {
      list = list.filter((c) => c.teamId === teamFilter);
    }

    if (sortField) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
          case 'displayName': cmp = a.displayName.localeCompare(b.displayName); break;
          case 'team': cmp = (teamMap.get(a.teamId!) ?? '').localeCompare(teamMap.get(b.teamId!) ?? ''); break;
          case 'scoreOverall': cmp = (a.scoreOverall ?? -1) - (b.scoreOverall ?? -1); break;
          case 'scoreSecurity': cmp = (a.scoreSecurity ?? -1) - (b.scoreSecurity ?? -1); break;
          case 'scoreQuality': cmp = (a.scoreQuality ?? -1) - (b.scoreQuality ?? -1); break;
          case 'repoCount': cmp = a.repoCount - b.repoCount; break;
          case 'totalCommits': cmp = a.totalCommits - b.totalCommits; break;
          case 'loc': cmp = (a.totalLocAdded + a.totalLocRemoved) - (b.totalLocAdded + b.totalLocRemoved); break;
          case 'lastSeen': cmp = (a.lastSeen ?? '').localeCompare(b.lastSeen ?? ''); break;
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return list;
  }, [allContributors, search, teamFilter, sortField, sortDir, teamMap]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageIds = new Set(pageItems.map((c) => c.id));
  const allPageSelected = pageItems.length > 0 && pageItems.every((c) => selected.has(c.id));

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

  const selectAll = () => setSelected(new Set(filtered.map((c) => c.id)));
  const clearSelection = () => setSelected(new Set());

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

  return (
    <ErrorBoundary>
      <div className="beast-stack">
        <div className="beast-page-header">
          <div>
            <h1 className="beast-page-title">{t('contributors.title')}</h1>
            <p className="beast-page-subtitle">
              {data ? `${filtered.length} contributor${filtered.length !== 1 ? 's' : ''}` : t('contributors.subtitle')}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="beast-filter-row">
          <div className="beast-search-wrap beast-flex-1">
            <SearchIcon />
            <input
              type="text"
              placeholder={t('contributors.searchPlaceholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="beast-input beast-input-sm beast-search-input"
            />
          </div>

          {teams && teams.length > 0 && (
            <select
              value={teamFilter === 'all' ? 'all' : String(teamFilter)}
              onChange={(e) => {
                setTeamFilter(e.target.value === 'all' ? 'all' : Number(e.target.value));
                setPage(0);
              }}
              className="beast-select beast-select-sm w-auto"
            >
              <option value="all">{t('repos.allTeams')}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={String(tm.id)}>{tm.name}</option>
              ))}
            </select>
          )}

          <span className="beast-auto-right beast-page-subtitle">
            {filtered.length} contributor{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Bulk actions bar */}
        {selected.size > 0 && (
          <div className="beast-card beast-bulk-bar">
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

            <div className="beast-bulk-bar-actions">
              <div className="beast-dropdown-wrap">
                <button
                  onClick={() => setShowTeamDropdown(!showTeamDropdown)}
                  disabled={!!bulkLoading}
                  className="beast-btn beast-btn-outline beast-btn-sm"
                >
                  {bulkLoading === 'assign' ? t('contributors.assigning') : t('contributors.assignToTeam')}
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
              {selected.size >= 2 && (
                <button
                  onClick={() => setShowMerge(true)}
                  disabled={!!bulkLoading}
                  className="beast-btn beast-btn-primary beast-btn-sm"
                >
                  {t('contributors.merge')} ({selected.size})
                </button>
              )}
            </div>
          </div>
        )}

        {/* Table */}
        <div className="beast-table-wrap">
          {isLoading ? (
            <div className="beast-section-pad"><TableSkeleton rows={8} /></div>
          ) : !pageItems.length ? (
            <EmptyState
              title={search ? t('contributors.noContributorsSearch') : t('contributors.noContributors')}
              description={search ? t('contributors.noContributorsSearch') : t('contributors.noContributorsDesc')}
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
                    <SortableHeader field="displayName" label={t('contributors.contributor')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHeader field="team" label={t('contributors.team')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHeader field="scoreOverall" label={t('contributors.overall')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="center" />
                    <SortableHeader field="scoreSecurity" label={t('contributors.security')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="center" />
                    <SortableHeader field="scoreQuality" label={t('contributors.quality')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="center" />
                    <SortableHeader field="repoCount" label={t('contributors.reposSort')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableHeader field="totalCommits" label={t('contributors.commits')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableHeader field="loc" label={t('contributors.loc')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableHeader field="lastSeen" label={t('contributors.lastActive')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((dev) => (
                    <ContributorRow
                      key={dev.id}
                      contributor={dev}
                      teamName={dev.teamId ? teamMap.get(dev.teamId) : undefined}
                      isSelected={selected.has(dev.id)}
                      onToggle={() => toggleOne(dev.id)}
                    />
                  ))}
                </tbody>
              </table>

              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>

      {showMerge && currentWorkspace && (
        <MergeContributorModal
          mode="bulk"
          candidates={filtered.filter((c) => selected.has(c.id))}
          workspaceId={currentWorkspace.id}
          onConfirm={async (sourceIds, targetId) => {
            const errors: string[] = [];
            for (const sourceId of sourceIds) {
              try {
                await mergeMutation.mutateAsync({ sourceId, targetId });
                setSelected((prev) => {
                  const next = new Set(prev);
                  next.delete(sourceId);
                  return next;
                });
              } catch (err) {
                errors.push(err instanceof Error ? err.message : 'failed');
              }
            }
            if (errors.length === 0) {
              setShowMerge(false);
              clearSelection();
            }
          }}
          onClose={() => setShowMerge(false)}
          loading={mergeMutation.isPending}
          error={mergeMutation.error?.message ?? null}
        />
      )}
    </ErrorBoundary>
  );
}

// ── Contributor row ──────────────────────────────────────────────

function ContributorRow({
  contributor: dev,
  teamName,
  isSelected,
  onToggle,
}: {
  contributor: Contributor;
  teamName?: string;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className={cn(isSelected && 'bg-beast-red/5')}>
      <td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="beast-checkbox"
        />
      </td>
      <td>
        <Link to={`/contributors/${dev.id}`} className="beast-td-primary beast-row-link">
          {dev.displayName}
        </Link>
        <p className="beast-page-subtitle">
          {dev.emails[0]}
        </p>
      </td>
      <td>
        {teamName ?? '\u2014'}
      </td>
      <td className="text-center">
        <ScoreBadge score={dev.scoreOverall} />
      </td>
      <td className="text-center">
        <ScoreBadge score={dev.scoreSecurity} />
      </td>
      <td className="text-center">
        <ScoreBadge score={dev.scoreQuality} />
      </td>
      <td className="beast-td-numeric">
        {dev.repoCount}
      </td>
      <td className="beast-td-numeric">
        {dev.totalCommits.toLocaleString()}
      </td>
      <td className="beast-td-date">
        <span className="beast-loc-added">+{formatLOC(dev.totalLocAdded)}</span>
        {' / '}
        <span className="beast-loc-removed">-{formatLOC(dev.totalLocRemoved)}</span>
      </td>
      <td className="beast-td-date">
        {dev.lastSeen
          ? formatDate(dev.lastSeen)
          : '\u2014'}
      </td>
    </tr>
  );
}
