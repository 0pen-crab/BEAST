import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useScanEvents, useScanEventStats, useResolveScanEvent, useUnresolveScanEvent, useWorkspaceEvents } from '@/api/hooks';
import { ErrorBoundary } from '@/components/error-boundary';
import { TableSkeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import type { ScanEvent, WorkspaceEvent } from '@/api/types';

const LEVELS = ['all', 'error', 'warning', 'info'] as const;
const PAGE_SIZE = 25;

type Tab = 'scan' | 'workspace';

export function EventsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('scan');
  const [level, setLevel] = useState<string>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: stats } = useScanEventStats();
  const { data, isLoading } = useScanEvents({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(level !== 'all' ? { level } : {}),
    ...(showResolved ? {} : { resolved: false }),
  });

  const { data: wsEventsData, isLoading: wsEventsLoading } = useWorkspaceEvents({ limit: 50 });

  const events = data?.results ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Clamp the page when the unresolved count shrinks (e.g. resolving the last
  // event on the final page) so we never sit on an empty out-of-range page.
  useEffect(() => {
    if (data && totalPages > 0 && page > totalPages - 1) {
      setPage(totalPages - 1);
    }
  }, [data, totalPages, page]);

  const wsEvents = wsEventsData?.results ?? [];

  return (
    <ErrorBoundary>
      <div className="beast-stack-md">
        {/* Header */}
        <div>
          <h1 className="beast-page-title">{t('events.title')}</h1>
          <p className="beast-page-subtitle">{t('events.subtitle')}</p>
        </div>

        {/* Tab bar */}
        <div className="beast-tab-bar beast-tab-bar-spaced">
          <button
            onClick={() => { setTab('scan'); setPage(0); }}
            className={cn('beast-tab', tab === 'scan' && 'beast-tab-active')}
          >
            {t('events.scanEvents')}
          </button>
          <button
            onClick={() => setTab('workspace')}
            className={cn('beast-tab', tab === 'workspace' && 'beast-tab-active')}
          >
            {t('events.workspaceEvents')}
          </button>
        </div>

        {tab === 'scan' ? (
          <>
            {/* Stats cards */}
            <div className="beast-grid-4">
              <StatCard label={t('events.unresolvedErrors')} value={stats?.unresolvedErrors ?? 0} />
              <StatCard label={t('events.unresolvedWarnings')} value={stats?.unresolvedWarnings ?? 0} />
              <StatCard label={t('events.totalUnresolved')} value={stats?.unresolved ?? 0} />
              <StatCard label={t('events.totalEvents')} value={stats?.total ?? 0} />
            </div>

            {/* Filters */}
            <div className="beast-card beast-filter-row">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  onClick={() => { setLevel(l); setPage(0); }}
                  className={cn(
                    'beast-btn beast-btn-sm beast-capitalize',
                    level === l ? 'beast-btn-primary' : 'beast-btn-ghost',
                  )}
                >
                  {t(`events.levels.${l}`)}
                </button>
              ))}
              <div className="beast-divider" />
              <label className="beast-toggle-label">
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e) => { setShowResolved(e.target.checked); setPage(0); }}
                  className="beast-toggle"
                />
                <span className="beast-toggle-text">{t('events.showResolved')}</span>
              </label>
              <span className="beast-auto-right beast-pagination-info">
                {t('common.resultsCount', { count: totalCount })}
              </span>
            </div>

            {/* Event table */}
            {isLoading ? (
              <TableSkeleton rows={8} />
            ) : events.length === 0 ? (
              <EmptyState
                title={showResolved ? t('events.noEvents') : t('events.allClear')}
                description={showResolved ? '' : ''}
              />
            ) : (
              <>
                <div className="beast-table-wrap">
                  <table className="beast-table">
                    <thead>
                      <tr>
                        <th>{t('events.level')}</th>
                        <th>{t('events.message')}</th>
                        <th>{t('events.source')}</th>
                        <th>{t('events.repo')}</th>
                        <th>{t('events.date')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((event) => (
                        <EventRow
                          key={event.id}
                          event={event}
                          expanded={expandedId === event.id}
                          onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="beast-pagination">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="beast-pagination-btn"
                    >
                      {t('common.previous')}
                    </button>
                    <span className="beast-pagination-info">
                      {t('common.page')} {page + 1} {t('common.of')} {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="beast-pagination-btn"
                    >
                      {t('common.next')}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          /* Workspace Events tab */
          wsEventsLoading ? (
            <TableSkeleton rows={6} />
          ) : wsEvents.length === 0 ? (
            <EmptyState title={t('events.noEvents')} description="" />
          ) : (
            <div className="beast-table-wrap">
              <table className="beast-table">
                <thead>
                  <tr>
                    <th>{t('events.type')}</th>
                    <th>{t('events.details')}</th>
                    <th>{t('events.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {wsEvents.map((evt) => (
                    <WorkspaceEventRow key={evt.id} event={evt} />
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </ErrorBoundary>
  );
}

/* -- Workspace Event Row ----------------------------------------- */

const eventTypeBadge: Record<string, { label: string; classes: string }> = {
  repository_added: { label: 'events.repositoryAdded', classes: 'beast-event-badge-success' },
  sync_completed: { label: 'events.syncCompleted', classes: 'beast-event-badge-info' },
  sync_failed: { label: 'events.syncFailed', classes: 'beast-event-badge-error' },
  pipeline_error: { label: 'events.pipelineError', classes: 'beast-event-badge-error' },
  api_error: { label: 'events.apiError', classes: 'beast-event-badge-error' },
  contributor_ingest_failed: { label: 'events.contributorIngestFailed', classes: 'beast-event-badge-error' },
};

function WorkspaceEventRow({ event }: { event: WorkspaceEvent }) {
  const { t, i18n } = useTranslation();
  const badge = eventTypeBadge[event.eventType] ?? {
    label: event.eventType,
    classes: 'beast-badge-gray',
  };
  const payload = event.payload as Record<string, unknown>;

  const details: string[] = [];
  if (payload.repo_name) details.push(String(payload.repo_name));
  if (payload.org_name) details.push(String(payload.org_name));
  if (payload.provider) details.push(String(payload.provider));
  if (payload.repos_added !== undefined) details.push(`${payload.repos_added} ${t('events.reposAdded')}`);
  if (payload.repos_updated !== undefined) details.push(`${payload.repos_updated} ${t('events.reposUpdated')}`);

  return (
    <tr>
      <td>
        <span className={cn('beast-badge', badge.classes)}>
          {eventTypeBadge[event.eventType] ? t(badge.label) : event.eventType}
        </span>
      </td>
      <td>
        <span className="beast-td-primary">{details.join(' · ') || '—'}</span>
        {payload.repo_url ? (
          <p className="beast-text-hint beast-truncate">{String(payload.repo_url)}</p>
        ) : null}
      </td>
      <td className="beast-td-date tabular-nums">
        <span title={formatDateTime(event.createdAt)}>{relativeTime(event.createdAt, i18n.language)}</span>
      </td>
    </tr>
  );
}

/* -- Stat Card ---------------------------------------------------- */

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="beast-metric">
      <p className="beast-metric-label">{label}</p>
      <p className="beast-metric-value beast-metric-value-sm">{value}</p>
    </div>
  );
}

/* -- Scan Event Row ----------------------------------------------- */

const levelStyles: Record<string, { badge: string }> = {
  error: { badge: 'beast-badge-red' },
  warning: { badge: 'beast-badge-amber' },
  info: { badge: 'beast-badge-blue' },
};

function EventRow({ event, expanded, onToggle }: { event: ScanEvent; expanded: boolean; onToggle: () => void }) {
  const { t, i18n } = useTranslation();
  const resolve = useResolveScanEvent();
  const unresolve = useUnresolveScanEvent();
  const createdAt = new Date(event.createdAt);
  const style = levelStyles[event.level] ?? levelStyles.info;
  const hasDetails = event.details && Object.keys(event.details).length > 0;
  // Link to the specific repo page when the API resolved a repository id;
  // fall back to the repos list otherwise (e.g. events without a scan).
  const repoLink = event.repositoryId != null ? `/repos/${event.repositoryId}` : '/repos';

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'cursor-pointer',
          event.resolved && 'beast-opacity-50',
        )}
      >
        <td>
          <span className={cn('beast-badge beast-capitalize', style.badge)}>
            {t(`events.levels.${event.level}`)}
          </span>
        </td>
        <td className="beast-td-message">
          <span className="beast-td-primary">
            {event.message}
          </span>
          {event.resolved && (
            <span className="beast-badge beast-badge-green beast-badge-inline">
              {t('status.Resolved')}
            </span>
          )}
        </td>
        <td className="beast-text-hint">{event.source}</td>
        <td>
          {event.repoName ? (
            <Link to={repoLink} className="beast-link-red">{event.repoName}</Link>
          ) : '—'}
        </td>
        <td className="beast-td-date tabular-nums">
          <span title={formatDateTime(createdAt)}>{relativeTime(event.createdAt, i18n.language)}</span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {event.level !== 'info' && (
            event.resolved ? (
              <button
                onClick={() => unresolve.mutate(event.id)}
                disabled={unresolve.isPending}
                className="beast-btn beast-btn-outline beast-btn-sm"
              >
                {t('events.reopen')}
              </button>
            ) : (
              <button
                onClick={() => resolve.mutate({ id: event.id })}
                disabled={resolve.isPending}
                className="beast-btn beast-btn-primary beast-btn-sm"
              >
                {t('events.resolve')}
              </button>
            )
          )}
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr>
          <td colSpan={6}>
            <div className="beast-event-detail beast-stack">
              <div>
                <h4 className="beast-event-section-label">{t('events.message')}</h4>
                <p className="beast-text-body">{event.message}</p>
              </div>

              {event.repoName && (
                <div>
                  <h4 className="beast-event-section-label">{t('events.links')}</h4>
                  <Link to={repoLink} className="beast-btn beast-btn-outline beast-btn-sm">
                    {event.repoName}
                  </Link>
                </div>
              )}

              {hasDetails && (
                <div>
                  <h4 className="beast-event-section-label">{t('events.details')}</h4>
                  <pre className="beast-code-block">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                </div>
              )}

              <div className="beast-event-meta">
                <span>{t('events.id')}: {event.id}</span>
                <span>{t('events.source')}: {event.source}</span>
                {event.scanId && <span>{t('events.scan')}: <Link to={`/scans?scan=${event.scanId}`} className="beast-link-red">{event.scanId.slice(0, 8)}</Link></span>}
                {event.stepName && <span>{t('events.step')}: {event.stepName}</span>}
                {event.repoName && <span>{t('events.repo')}: {event.repoName}</span>}
                {event.workspaceId && <span>{t('events.workspaceId')}: {event.workspaceId}</span>}
                <span>{t('events.created')}: {formatDateTime(createdAt)}</span>
                {event.resolved && event.resolvedAt && (
                  <span>
                    {event.resolvedBy
                      ? t('events.resolvedMetaBy', { date: formatDateTime(event.resolvedAt), user: event.resolvedBy })
                      : t('events.resolvedMeta', { date: formatDateTime(event.resolvedAt) })}
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* -- Helpers ------------------------------------------------------ */

/**
 * Locale-aware relative time ("5 minutes ago" / "5 хвилин тому").
 * Exported for tests. Absolute time belongs in the `title` attribute.
 */
export function relativeTime(dateStr: string | Date, lang: string): string {
  const then = new Date(dateStr).getTime();
  const diffSec = Math.round((then - Date.now()) / 1000); // negative = past
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.trunc(diffSec / 3600), 'hour');
  return rtf.format(Math.trunc(diffSec / 86400), 'day');
}
