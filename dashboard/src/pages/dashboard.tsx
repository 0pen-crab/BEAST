import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useFindingCounts, useFindingCountsByTool, useRepositories } from '@/api/hooks';
import { apiFetch } from '@/api/client';
import { useWorkspace } from '@/lib/workspace';
import { TableSkeleton } from '@/components/skeleton';
import { ErrorBoundary } from '@/components/error-boundary';
import { TOOL_CATEGORIES, getToolsByCategory } from '@/lib/tool-mapping';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { Severity } from '@/api/types';

interface Scan {
  id: string;
  status: string;
  repoName: string;
  createdAt: string;
  completedAt: string | null;
  startedAt: string | null;
}

export function DashboardPage() {
  const { t } = useTranslation();
  return (
    <ErrorBoundary>
      <div className="beast-stack">
        <div>
          <h1 className="beast-page-title">{t('dashboard.title')}</h1>
          <p className="beast-page-subtitle">{t('dashboard.subtitle')}</p>
        </div>
        <div className="beast-grid-2">
          <SeverityBreakdownBar />
          <ToolSummary />
        </div>
        <div className="beast-grid-3">
          <div className="beast-grid-span-2">
            <RecentScans />
          </div>
          <TopRepos />
        </div>
      </div>
    </ErrorBoundary>
  );
}

const LEGEND_DOTS: Record<Severity, string> = {
  Critical: 'beast-legend-dot-critical',
  High: 'beast-legend-dot-high',
  Medium: 'beast-legend-dot-medium',
  Low: 'beast-legend-dot-low',
  Info: 'beast-legend-dot-info',
};

const RING_STROKES: Record<Severity, string> = {
  Critical: '#dc2626',
  High: '#ea580c',
  Medium: '#ca8a04',
  Low: '#22c55e',
  Info: '#71717a',
};

function SeverityBreakdownBar() {
  const { t } = useTranslation();
  const { data } = useFindingCounts();
  if (!data) return null;

  const segments: { severity: Severity; count: number }[] = [
    { severity: 'Critical', count: data.Critical },
    { severity: 'High', count: data.High },
    { severity: 'Medium', count: data.Medium },
    { severity: 'Low', count: data.Low },
    { severity: 'Info', count: data.Info },
  ];

  const radius = 70;
  const strokeWidth = 24;
  const center = 88;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="beast-card beast-flex-col">
      <div className="beast-flex-between">
        <h3 className="beast-card-title">{t('dashboard.severityDistribution')}</h3>
        <span className="beast-page-subtitle">{data.total} {t('dashboard.totalFindings')}</span>
      </div>
      <div className="beast-flex-center beast-flex-1 beast-flex-gap-lg">
        <div className="beast-donut-wrap">
          <svg width={center * 2} height={center * 2} viewBox={`0 0 ${center * 2} ${center * 2}`}>
            {data.total === 0 && (
              <circle cx={center} cy={center} r={radius} fill="none" stroke="#2a2a2c" strokeWidth={strokeWidth} />
            )}
            {segments.map((s) => {
              if (s.count === 0) return null;
              const pct = s.count / data.total;
              const dash = pct * circumference;
              const gap = circumference - dash;
              const currentOffset = offset;
              offset += dash;
              return (
                <circle
                  key={s.severity}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={RING_STROKES[s.severity]}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={-currentOffset}
                  className="ring-segment"
                />
              );
            })}
          </svg>
          <div className="beast-donut-center">
            <span className="beast-metric-value beast-metric-value-sm">{data.total}</span>
            <span className="beast-metric-label">{t('dashboard.totalFindings')}</span>
          </div>
        </div>
        <div className="beast-flex-col beast-flex-gap-sm">
          {segments.map((s) => (
            <div key={s.severity} className="beast-flex beast-flex-gap-sm">
              <span className={cn('beast-legend-dot', LEGEND_DOTS[s.severity])} />
              <span className="beast-page-subtitle beast-legend-label">{s.severity}</span>
              <span className="beast-td-numeric">{s.count}</span>
              <span className="beast-page-subtitle">({(data.total > 0 ? (s.count / data.total) * 100 : 0).toFixed(0)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

const STATUS_PILL: Record<string, string> = {
  'completed': 'status-completed',
  'running': 'status-running',
  'queued': 'status-queued',
  'failed': 'status-failed',
};

function RecentScans() {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const { data, isLoading } = useQuery({
    queryKey: ['recentScans', wsId],
    queryFn: async () => {
      const res = await apiFetch(`/api/scans?limit=10&workspace_id=${wsId}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ count: number; results: Scan[] }>;
    },
    enabled: !!wsId,
  });

  return (
    <div className="beast-card beast-card-flush">
      <div className="beast-card-header">
        <h2 className="beast-card-title">{t('dashboard.recentScans')}</h2>
      </div>
      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : !data?.results.length ? (
        <p className="beast-empty">{t('dashboard.noScansYet')}</p>
      ) : (
        <table className="beast-table">
          <thead>
            <tr>
              <th>{t('dashboard.repository')}</th>
              <th>Status</th>
              <th className="beast-th-right">{t('dashboard.duration')}</th>
              <th className="beast-th-right">{t('dashboard.completed')}</th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((scan) => (
              <tr key={scan.id}>
                <td>
                  <Link to="/scans" className="beast-td-primary beast-row-link">
                    {scan.repoName}
                  </Link>
                </td>
                <td>
                  <span className={cn('status-pill', STATUS_PILL[scan.status] ?? 'status-queued')}>
                    {t(`status.${scan.status}`)}
                  </span>
                </td>
                <td className="beast-td-date">
                  {scan.startedAt && scan.completedAt ? formatDuration(scan.startedAt, scan.completedAt) : '—'}
                </td>
                <td className="beast-td-date">
                  {scan.completedAt
                    ? formatDate(scan.completedAt)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TopRepos() {
  const { t } = useTranslation();
  const { data: repos, isLoading } = useRepositories();

  return (
    <div className="beast-card beast-card-flush">
      <div className="beast-card-header">
        <h2 className="beast-card-title">{t('dashboard.repositories')}</h2>
      </div>
      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : !repos?.length ? (
        <p className="beast-empty">{t('dashboard.noReposYet')}</p>
      ) : (
        <table className="beast-table">
          <thead>
            <tr>
              <th>{t('dashboard.repository')}</th>
              <th className="beast-th-right">{t('dashboard.findings')}</th>
            </tr>
          </thead>
          <tbody>
            {repos.slice(0, 10).map((repo) => (
              <tr key={repo.id}>
                <td>
                  <Link to={`/repos/${repo.id}`} className="beast-td-primary beast-row-link">
                    {repo.name}
                  </Link>
                </td>
                <td className="beast-td-numeric">{repo.findingsCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ToolSummary() {
  const { t } = useTranslation();
  const { data: toolCounts } = useFindingCountsByTool();

  const countsByTool = new Map(
    (toolCounts ?? []).map((tc) => [tc.tool, tc]),
  );

  return (
    <div className="beast-card beast-card-flush beast-flex-col">
      <table className="beast-table beast-table-stretch">
        <thead>
          <tr>
            <th>{t('dashboard.securityTools')}</th>
            <th className="beast-th-right">{t('dashboard.activeFindings', 'Active')}</th>
            <th className="beast-th-right">{t('dashboard.dismissed', 'Dismissed')}</th>
          </tr>
        </thead>
        <tbody>
          {TOOL_CATEGORIES.map((cat) => {
            const tools = getToolsByCategory(cat.key);
            let active = 0;
            let dismissed = 0;
            for (const tool of tools) {
              const counts = countsByTool.get(tool.key);
              active += counts?.active ?? 0;
              dismissed += counts?.dismissed ?? 0;
            }
            const toolNames = tools.map((t) => t.displayName).join(', ');
            return (
              <tr key={cat.key}>
                <td>
                  <div className="beast-flex beast-flex-gap">
                    <span className={cn('beast-tool-icon', `beast-tool-icon-${cat.key}`)}>
                      {cat.icon}
                    </span>
                    <div>
                      <p className={cn('beast-td-primary', `beast-cat-text-${cat.key}`)}>
                        {cat.displayName}
                      </p>
                      <p className="beast-page-subtitle">{toolNames}</p>
                    </div>
                  </div>
                </td>
                <td className="beast-td-numeric">{active}</td>
                <td className="beast-td-numeric">{dismissed}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
