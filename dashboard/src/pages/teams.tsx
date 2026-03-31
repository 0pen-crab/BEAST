import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useTeams, useCreateTeam } from '@/api/hooks';
import { TableSkeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { ErrorBoundary } from '@/components/error-boundary';
import { Pagination } from '@/components/pagination';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { Team } from '@/api/types';

const PAGE_SIZE = 25;

// ── Risk score badge ────────────────────────────────────────────

function RiskScoreBadge({ score }: { score: number }) {
  const cls = score === 0 ? 'beast-risk-none'
    : score < 3 ? 'beast-risk-low'
    : score < 6 ? 'beast-risk-medium'
    : score < 8 ? 'beast-risk-high'
    : 'beast-risk-critical';
  return <span className={cn('beast-risk-badge', cls)}>{score.toFixed(1)}</span>;
}

// ── Sortable header ──────────────────────────────────────────────

type SortField = 'name' | 'repoCount' | 'contributorCount' | 'findingsCount' | 'avgRiskScore' | 'createdAt';
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

export function TeamsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const { data: allTeams, isLoading } = useTeams();
  const createTeam = useCreateTeam();

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
    let teams = allTeams ?? [];

    if (search) {
      const q = search.toLowerCase();
      teams = teams.filter((tm) =>
        tm.name.toLowerCase().includes(q) ||
        (tm.description?.toLowerCase().includes(q) ?? false),
      );
    }

    if (sortField) {
      teams = [...teams].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
          case 'name': cmp = a.name.localeCompare(b.name); break;
          case 'repoCount': cmp = (a.repoCount ?? 0) - (b.repoCount ?? 0); break;
          case 'contributorCount': cmp = (a.contributorCount ?? 0) - (b.contributorCount ?? 0); break;
          case 'findingsCount': cmp = (a.findingsCount ?? 0) - (b.findingsCount ?? 0); break;
          case 'avgRiskScore': cmp = (a.avgRiskScore ?? 0) - (b.avgRiskScore ?? 0); break;
          case 'createdAt': cmp = a.createdAt.localeCompare(b.createdAt); break;
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return teams;
  }, [allTeams, search, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageTeams = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  return (
    <ErrorBoundary>
      <div className="beast-stack">
        <div className="beast-page-header">
          <div>
            <h1 className="beast-page-title">{t('teams.title')}</h1>
            <p className="beast-page-subtitle">
              {allTeams ? `${filtered.length} ${t('teams.title').toLowerCase()}` : t('teams.subtitle')}
            </p>
          </div>
          <button
            className="beast-btn beast-btn-primary"
            onClick={() => setShowCreate(true)}
          >
            {t('teams.createTeam')}
          </button>
        </div>

        <div className="beast-filter-row">
          <input
            type="text"
            className="beast-input beast-input-sm"
            placeholder={t('teams.searchPlaceholder')}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <div className="beast-table-wrap">
          {isLoading ? (
            <div className="beast-section-pad"><TableSkeleton rows={8} /></div>
          ) : !pageTeams.length ? (
            <EmptyState
              title={search ? t('teams.noMatchingTeams') : t('teams.noTeams')}
              description={search ? t('teams.tryDifferentSearch') : t('teams.noTeamsDesc')}
            />
          ) : (
            <>
              <table className="beast-table">
                <thead>
                  <tr>
                    <SortableHeader field="name" label={t('teams.team')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHeader field="repoCount" label={t('teams.reposCount')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableHeader field="contributorCount" label={t('teams.contributorsCount')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableHeader field="findingsCount" label={t('teams.findingsCount')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableHeader field="avgRiskScore" label={t('teams.avgRisk')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableHeader field="createdAt" label={t('teams.created')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {pageTeams.map((team) => (
                    <TeamRow key={team.id} team={team} />
                  ))}
                </tbody>
              </table>

              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </div>

        {showCreate && (
          <div className="beast-overlay">
            <div className="beast-backdrop" onClick={() => setShowCreate(false)} />
            <div className="beast-modal">
              <h3 className="beast-modal-title">{t('teams.createTeam')}</h3>
              <form
                className="beast-form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newName.trim()) return;
                  createTeam.mutate(
                    { name: newName.trim(), description: newDesc.trim() },
                    {
                      onSuccess: () => {
                        setShowCreate(false);
                        setNewName('');
                        setNewDesc('');
                      },
                    },
                  );
                }}
              >
                <div className="beast-form-group">
                  <label className="beast-label">{t('teams.teamName')}</label>
                  <input
                    type="text"
                    className="beast-input"
                    placeholder={t('teams.teamName')}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="beast-form-group">
                  <label className="beast-label">{t('repo.description')}</label>
                  <input
                    type="text"
                    className="beast-input"
                    placeholder={`${t('repo.description')} (${t('common.optional')})`}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>
                <div className="beast-modal-actions">
                  <button
                    type="button"
                    className="beast-btn beast-btn-outline beast-btn-sm"
                    onClick={() => setShowCreate(false)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="beast-btn beast-btn-primary beast-btn-sm"
                    disabled={!newName.trim() || createTeam.isPending}
                  >
                    {t('common.create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

// ── Team row ─────────────────────────────────────────────────────

function TeamRow({ team }: { team: Team }) {
  const navigate = useNavigate();
  return (
    <tr className="beast-tr-clickable" onClick={() => navigate(`/teams/${team.id}`)}>
      <td className="beast-td-primary">
        {team.name}
        {team.description && (
          <div className="beast-td-subtitle">{team.description}</div>
        )}
      </td>
      <td className="beast-td-numeric">{team.repoCount ?? 0}</td>
      <td className="beast-td-numeric">{team.contributorCount ?? 0}</td>
      <td className="beast-td-numeric">{team.findingsCount ?? 0}</td>
      <td className="beast-td-numeric">
        <RiskScoreBadge score={team.avgRiskScore ?? 0} />
      </td>
      <td className="beast-td-date">{formatDate(team.createdAt)}</td>
    </tr>
  );
}
