import { useState, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useFindingCounts, useFindingCountsByTool, useRepositories } from '@/api/hooks';
import { apiFetch, mutateApi } from '@/api/client';
import { useWorkspace } from '@/lib/workspace';
import { TableSkeleton } from '@/components/skeleton';
import { ErrorBoundary } from '@/components/error-boundary';
import { TOOL_CATEGORIES, getToolsByCategory } from '@/lib/tool-mapping';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { downloadBlob } from '@/lib/export-findings';
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
        <div className="beast-flex-between beast-flex-wrap">
          <div className="beast-flex-grow">
            <h1 className="beast-page-title">{t('dashboard.title')}</h1>
            <p className="beast-page-subtitle">{t('dashboard.subtitle')}</p>
          </div>
          <SecurityBrief />
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

type BriefState =
  | { phase: 'idle' }
  | { phase: 'processing'; jobId: string }
  | { phase: 'done'; jobId: string }
  | { phase: 'error'; message: string };

function SecurityBrief() {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const [state, setState] = useState<BriefState>({ phase: 'idle' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/highlights/${jobId}?workspace_id=${wsId}`);
        if (!res.ok) {
          setState({ phase: 'error', message: 'Failed to check status' });
          clearInterval(pollRef.current!);
          return;
        }
        const data = await res.json() as { status: string; error?: string };
        if (data.status === 'done') {
          clearInterval(pollRef.current!);
          setState({ phase: 'done', jobId });
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current!);
          setState({ phase: 'error', message: data.error ?? t('dashboard.securityBriefFailed') });
        }
      } catch {
        clearInterval(pollRef.current!);
        setState({ phase: 'error', message: t('dashboard.securityBriefFailed') });
      }
    }, 3000);
  }, [wsId, t]);

  // On mount: restore state from backend if there's an active/done job
  useEffect(() => {
    if (!wsId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/highlights/latest?workspace_id=${wsId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as { job: { id: string; status: string; error?: string } | null };
        if (!data.job || cancelled) return;
        if (data.job.status === 'processing') {
          setState({ phase: 'processing', jobId: data.job.id });
          startPolling(data.job.id);
        } else if (data.job.status === 'done') {
          setState({ phase: 'done', jobId: data.job.id });
        } else if (data.job.status === 'failed') {
          setState({ phase: 'error', message: data.job.error ?? t('dashboard.securityBriefFailed') });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [wsId, startPolling, t]);

  const handleGenerate = useCallback(async () => {
    if (!wsId) return;
    setState({ phase: 'processing', jobId: '' });
    try {
      const res = await apiFetch(`/api/highlights/generate?workspace_id=${wsId}`, { method: 'POST' });
      const data = await res.json() as { jobId?: string; error?: string; message?: string };
      if (!res.ok || !data.jobId) {
        setState({
          phase: 'error',
          message: data.message ?? data.error ?? t('dashboard.securityBriefFailed'),
        });
        return;
      }
      setState({ phase: 'processing', jobId: data.jobId });
      startPolling(data.jobId);
    } catch {
      setState({ phase: 'error', message: t('dashboard.securityBriefFailed') });
    }
  }, [wsId, startPolling, t]);

  const handleDownload = useCallback(async () => {
    if (state.phase !== 'done' || !wsId) return;
    try {
      const res = await apiFetch(`/api/highlights/${state.jobId}/download?workspace_id=${wsId}`);
      if (!res.ok) return;
      const blob = await res.blob();
      downloadBlob(`security-brief-${new Date().toISOString().slice(0, 10)}.csv`, blob);
    } catch {
      // silent — download failed
    }
  }, [state, wsId]);

  const isProcessing = state.phase === 'processing';
  const isDone = state.phase === 'done';
  const isError = state.phase === 'error';

  return (
    <div className="beast-brief-group">
      <button
        className={cn('beast-btn-brief', isProcessing && 'beast-btn-brief-processing')}
        onClick={handleGenerate}
        disabled={isProcessing || !wsId}
      >
        {isProcessing && <span className="beast-brief-spinner" />}
        {isProcessing ? t('dashboard.securityBriefProcessing') : t('dashboard.securityBrief')}
      </button>
      {isDone && (
        <button
          className="beast-btn-brief-download"
          onClick={handleDownload}
          title={t('dashboard.securityBriefDownload')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      )}
      {isError && (
        <span className="beast-brief-error">{state.message}</span>
      )}
    </div>
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
