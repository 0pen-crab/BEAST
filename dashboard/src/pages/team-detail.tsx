import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useTeam, useRepositories, useTeamContributors } from '@/api/hooks';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { TableSkeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { ErrorBoundary } from '@/components/error-boundary';
import { Pagination } from '@/components/pagination';
import { formatDate, formatCompact, formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 15;

const AVATAR_COLORS = ['#dc2626', '#7c3aed', '#0891b2', '#ca8a04', '#059669', '#be185d', '#2563eb', '#d97706'];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

type SortField = 'name' | 'findingsCount' | 'size' | 'riskScore' | 'lastScannedAt';
type SortDir = 'asc' | 'desc';

function SortableHeader({
  field, label, sortField, sortDir, onSort, align,
}: {
  field: SortField; label: string; sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void; align?: 'right';
}) {
  const active = sortField === field;
  return (
    <th className={cn(align === 'right' && 'beast-th-right')}>
      <button type="button" onClick={() => onSort(field)}
        className={cn('beast-th-sort', active && 'beast-th-sort-active')}>
        {label}
        <span className="beast-sort-arrows">
          <span className={active && sortDir === 'asc' ? 'active' : ''}>&#9650;</span>
          <span className={active && sortDir === 'desc' ? 'active' : ''}>&#9660;</span>
        </span>
      </button>
    </th>
  );
}

function RiskScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="beast-text-muted">&mdash;</span>;
  const cls = score === 0 ? 'beast-risk-none'
    : score < 3 ? 'beast-risk-low'
    : score < 6 ? 'beast-risk-medium'
    : score < 8 ? 'beast-risk-high'
    : 'beast-risk-critical';
  return <span className={cn('beast-risk-badge', cls)}>{score.toFixed(1)}</span>;
}

export function TeamDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const teamId = Number(id);
  const { data: team } = useTeam(teamId);
  const { data: repos, isLoading } = useRepositories({ team_id: teamId });
  const { data: contributors } = useTeamContributors(teamId);

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(0);
  };

  const sortedRepos = useMemo(() => {
    if (!repos) return [];
    const copy = [...repos];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'findingsCount':
          cmp = (a.findingsCount ?? 0) - (b.findingsCount ?? 0);
          break;
        case 'size':
          cmp = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
          break;
        case 'riskScore':
          cmp = (a.riskScore ?? 0) - (b.riskScore ?? 0);
          break;
        case 'lastScannedAt':
          cmp = new Date(a.lastScannedAt ?? 0).getTime() - new Date(b.lastScannedAt ?? 0).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [repos, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRepos.length / PAGE_SIZE));
  const pagedRepos = sortedRepos.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Compute total LOC from contributors (snake_case fields from raw SQL)
  const totalLoc = useMemo(() => {
    if (!contributors?.length) return 0;
    return contributors.reduce((sum: number, c: any) => sum + Number(c.total_loc_added ?? c.totalLocAdded ?? 0), 0);
  }, [contributors]);

  return (
    <ErrorBoundary>
      <div className="beast-stack-md">
        <BreadcrumbNav items={[{ label: t('nav.teams'), to: '/teams' }, { label: team?.name ?? '...' }]} />

        <div>
          <h1 className="beast-page-title">{team?.name}</h1>
          {team?.description && <p className="beast-page-subtitle">{team.description}</p>}
        </div>

        {team && (
          <div className="beast-grid-5">
            <div className="beast-metric">
              <div className="beast-metric-label">{t('teams.reposCount')}</div>
              <div className="beast-metric-value beast-metric-value-sm">{team.repoCount ?? 0}</div>
            </div>
            <div className="beast-metric">
              <div className="beast-metric-label">{t('teams.contributorsCount')}</div>
              <div className="beast-metric-value beast-metric-value-sm">{team.contributorCount ?? 0}</div>
            </div>
            <div className="beast-metric beast-metric-accent">
              <div className="beast-metric-label">{t('teams.findingsCount')}</div>
              <div className="beast-metric-value beast-metric-value-sm beast-metric-value-red">{team.findingsCount ?? 0}</div>
            </div>
            <div className="beast-metric">
              <div className="beast-metric-label">Lines of Code</div>
              <div className="beast-metric-value beast-metric-value-sm">{formatCompact(totalLoc)}</div>
            </div>
            <div className="beast-metric">
              <div className="beast-metric-label">Risk Score</div>
              <div className="beast-metric-value beast-metric-value-sm">{(team.avgRiskScore ?? 0).toFixed(1)}</div>
            </div>
          </div>
        )}

        <div className="beast-split">
          <div>
            {isLoading ? (
              <TableSkeleton rows={5} />
            ) : !repos?.length ? (
              <EmptyState title={t('teams.noRepos')} description={t('teams.noReposDesc')} />
            ) : (
              <>
                <div className="beast-table-wrap">
                  <table className="beast-table">
                    <thead>
                      <tr>
                        <SortableHeader field="name" label={t('teams.repository')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                        <SortableHeader field="size" label={t('repos.size')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                        <SortableHeader field="findingsCount" label={t('teams.findingsCount')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                        <SortableHeader field="riskScore" label={t('teams.risk')} sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                        <SortableHeader field="lastScannedAt" label="Last Scanned" sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRepos.map((repo) => (
                        <RepoRow
                          key={repo.id}
                          repoId={repo.id}
                          name={repo.name}
                          sizeBytes={repo.sizeBytes}
                          lastScannedAt={repo.lastScannedAt}
                          findingsCount={repo.findingsCount}
                          riskScore={repo.riskScore}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </>
            )}
          </div>

          <div className="beast-card beast-card-flush">
            <div className="beast-card-header">
              <h3 className="beast-card-title">
                {t('teams.contributorsCount')} ({contributors?.length ?? 0})
              </h3>
            </div>
            {!contributors?.length ? (
              <EmptyState title={t('teams.noContributors')} description={t('teams.noContributorsDesc')} />
            ) : (
              <div>
                {contributors.map((c: any) => {
                  const name = c.display_name ?? c.displayName ?? '';
                  const commits = c.total_commits ?? c.totalCommits ?? 0;
                  const locAdded = c.total_loc_added ?? c.totalLocAdded ?? 0;
                  const locRemoved = c.total_loc_removed ?? c.totalLocRemoved ?? 0;
                  const score = c.score_overall ?? c.scoreOverall ?? null;
                  const scoreClass = score == null ? '' : score >= 7 ? 'beast-score-good' : score >= 5 ? 'beast-score-mid' : 'beast-score-bad';

                  return (
                    <Link key={c.id} to={`/contributors/${c.id}`} className="beast-contributor-item">
                      <span
                        className="beast-contributor-avatar"
                        style={{ backgroundColor: avatarColor(name) }}
                      >
                        {initials(name)}
                      </span>
                      <span className="beast-contributor-info">
                        <span className="beast-contributor-name">{name}</span>
                        <span className="beast-contributor-meta">
                          {commits} {t('teams.commits')} · +{formatCompact(locAdded)} -{formatCompact(locRemoved)}
                        </span>
                      </span>
                      <span className="beast-contributor-score">
                        {score != null && (
                          <span className={cn('beast-score', scoreClass)}>{score.toFixed(1)}</span>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

function RepoRow({
  repoId,
  name,
  sizeBytes,
  lastScannedAt,
  findingsCount,
  riskScore,
}: {
  repoId: number;
  name: string;
  sizeBytes?: number | null;
  lastScannedAt?: string | null;
  findingsCount?: number;
  riskScore?: number | null;
}) {
  return (
    <tr>
      <td>
        <Link to={`/repos/${repoId}`} className="beast-td-primary beast-link">
          {name}
        </Link>
      </td>
      <td className="beast-td-date">
        {formatBytes(sizeBytes)}
      </td>
      <td className="beast-td-numeric">
        {findingsCount ?? 0}
      </td>
      <td className="beast-td-numeric">
        <RiskScoreBadge score={riskScore} />
      </td>
      <td className="beast-td-date">
        {lastScannedAt ? formatDate(lastScannedAt) : '\u2014'}
      </td>
    </tr>
  );
}
