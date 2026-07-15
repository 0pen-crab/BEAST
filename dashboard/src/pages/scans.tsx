import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ErrorBoundary } from '@/components/error-boundary';
import { useScans, useScanDetail, useScanStats, useScanLogs, useScanLogContent, useCancelScan, useRemoveScan, useResumeScan } from '@/api/hooks';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useCurrentWorkspaceRole, canWrite } from '@/lib/permissions';
import { PipelineProgress, type PipelineStep } from '@/components/pipeline-progress';
import { CardSkeleton } from '@/components/skeleton';
import { formatDateTime } from '@/lib/format';
import i18n from '@/lib/i18n';
import type { ScanDetail, ScanStep, ScanStepError } from '@/api/types';

/** Translate function shape (react-i18next `t`) — kept loose so helpers stay simple. */
type TFn = (key: string, options?: Record<string, unknown>) => string;

// DISPLAY stages — what the user sees. The orchestrator's findings work
// (triage-report → mitigation-check → commit, see api/src/orchestrator/
// pipeline.ts) is presented as ONE 'findings' stage; the other stages map
// 1:1 to backend steps. Exported for tests.
// Labels live in the locale files under `scans.stages.*`.
export const PIPELINE_STAGES: { key: string; labelKey: string }[] = [
  { key: 'clone', labelKey: 'scans.stages.clone' },
  { key: 'analysis', labelKey: 'scans.stages.analysis' },
  { key: 'security-tools', labelKey: 'scans.stages.security-tools' },
  { key: 'ai-research', labelKey: 'scans.stages.ai-research' },
  { key: 'import', labelKey: 'scans.stages.import' },
  { key: 'findings', labelKey: 'scans.stages.findings' },
];

/** Backend steps folded into the 'findings' display stage, in pipeline order. */
export const FINDINGS_SUB_STEPS = ['triage-report', 'mitigation-check', 'commit'] as const;

/** Sub-step labels — shown inside the findings stage detail and on log buttons. */
const SUB_STAGE_LABEL_KEYS: Record<string, string> = {
  'triage-report': 'scans.stages.triage-report',
  'mitigation-check': 'scans.stages.mitigation-check',
  'commit': 'scans.stages.commit',
};

type DisplayStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Status of the 'findings' display stage from its three backend sub-steps.
 * The group reads as one unit: done only when EVERY sub-step is done, running
 * while it's anywhere in between, failed as soon as anything failed.
 */
export function aggregateFindingsStatus(scanSteps: ScanStep[]): DisplayStatus {
  const statuses = FINDINGS_SUB_STEPS.map(
    name => scanSteps.find(s => s.stepName === name)?.status ?? 'pending',
  );
  const done = (s: string) => s === 'completed' || s === 'skipped';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('running')) return 'running';
  if (statuses.every(s => s === 'skipped')) return 'skipped';
  if (statuses.every(done)) return 'completed';
  if (statuses.some(done)) return 'running'; // between sub-steps
  return 'pending';
}

/** Status of a display stage — aggregated for 'findings', direct otherwise. */
function displayStageStatus(stageKey: string, scanSteps: ScanStep[]): DisplayStatus {
  if (stageKey === 'findings') return aggregateFindingsStatus(scanSteps);
  const status = scanSteps.find(s => s.stepName === stageKey)?.status ?? 'pending';
  return status === 'running' || status === 'completed' || status === 'failed' || status === 'skipped'
    ? status
    : 'pending';
}

/** Localized label for a pipeline step key; falls back to the raw step name.
 *  Findings sub-steps resolve to the merged stage label — the user-facing
 *  pipeline has one findings stage. */
function stageLabel(stepKey: string | null | undefined, t: TFn): string {
  if (!stepKey) return '';
  const stage = PIPELINE_STAGES.find(s => s.key === stepKey);
  if (stage) return t(stage.labelKey);
  if ((FINDINGS_SUB_STEPS as readonly string[]).includes(stepKey)) return t('scans.stages.findings');
  return stepKey;
}

/** Map scan steps to PipelineProgress display steps */
function toPipelineSteps(scanSteps: ScanStep[], t: TFn, showDurations?: boolean): PipelineStep[] {
  return PIPELINE_STAGES.map((stage) => {
    const status = displayStageStatus(stage.key, scanSteps);

    let sublabel: string | undefined;
    if (showDurations) {
      const subSteps = stage.key === 'findings'
        ? scanSteps.filter(s => (FINDINGS_SUB_STEPS as readonly string[]).includes(s.stepName))
        : scanSteps.filter(s => s.stepName === stage.key);
      const totalMs = subSteps.reduce((sum, s) => (s.startedAt && s.completedAt)
        ? sum + (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime())
        : sum, 0);
      if (totalMs > 0) sublabel = formatDuration(Math.round(totalMs / 1000));
    }

    return {
      key: stage.key,
      label: t(stage.labelKey),
      status,
      sublabel,
    };
  });
}

// ── Live elapsed timer hook ────────────────────────────────────

function useLiveElapsed(startedAt: string | null): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(null);
      return;
    }
    const start = new Date(startedAt).getTime();
    startRef.current = start;
    const update = () => setElapsed(Math.round((Date.now() - start) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return elapsed;
}

// ── Page ───────────────────────────────────────────────────────

export function ScansPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const wsRole = useCurrentWorkspaceRole();
  const canEdit = user ? canWrite(user.role, wsRole ?? undefined) : false;

  // The active tab lives in the URL (?tab=completed|failed, default active is
  // kept out of it) so refresh / shared links restore the view — same
  // convention as the repo page.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: 'active' | 'completed' | 'failed' =
    tabParam === 'completed' || tabParam === 'failed' ? tabParam : 'active';

  // Manual tab switches push a history entry (back button friendly) and drop
  // any ?scan= deep link so it doesn't re-force its own tab afterwards.
  const selectTab = (tabKey: 'active' | 'completed' | 'failed') => {
    const next = new URLSearchParams(searchParams);
    if (tabKey === 'active') next.delete('tab');
    else next.set('tab', tabKey);
    next.delete('scan');
    setSearchParams(next);
  };

  // Deep link from the dashboard: /scans?scan={id} — pick the right tab,
  // scroll the scan into view and highlight it briefly. While ?scan= is
  // present it wins over ?tab= (the tab is rewritten in place, no new
  // history entry).
  const targetScanId = searchParams.get('scan');
  const { data: targetScan } = useScanDetail(targetScanId);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (!targetScan) return;
    const scanTab = targetScan.status === 'completed' ? 'completed'
      : targetScan.status === 'failed' ? 'failed'
      : 'active';
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (scanTab === 'active') next.delete('tab');
      else next.set('tab', scanTab);
      return next;
    }, { replace: true });
    setHighlightId(targetScan.id);
    const timer = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(timer);
  }, [targetScan?.id, targetScan?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ErrorBoundary>
      <div className="beast-stack-md">
        <div>
          <h1 className="beast-page-title">{t('scans.title')}</h1>
          <p className="beast-page-subtitle">{t('scans.subtitle')}</p>
        </div>

        <StatsBar />
        <RunningScans canEdit={canEdit} highlightId={highlightId} />

        <div>
          <div className="beast-tab-bar beast-tab-bar-spaced">
            {(['active', 'completed', 'failed'] as const).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => selectTab(tabKey)}
                className={cn('beast-tab', tab === tabKey && 'beast-tab-active')}
              >
                {tabKey === 'active' ? t('scans.queue') : tabKey === 'completed' ? t('scans.completed') : t('scans.failed')}
              </button>
            ))}
          </div>

          {tab === 'active' && <ScanTable status="queued" canEdit={canEdit} highlightId={highlightId} />}
          {tab === 'completed' && <ScanTable status="completed" canEdit={canEdit} highlightId={highlightId} />}
          {tab === 'failed' && <ScanTable status="failed" canEdit={canEdit} highlightId={highlightId} />}
        </div>
      </div>
    </ErrorBoundary>
  );
}

// ── Stats Bar ──────────────────────────────────────────────────

function StatsBar() {
  const { t } = useTranslation();
  const { data: stats } = useScanStats();
  if (!stats) {
    return (
      <div className="beast-grid-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const cards: { label: string; value: string | number; sub?: string; accent?: string }[] = [
    { label: t('scans.totalScans'), value: stats.total },
    {
      label: t('scans.running'), value: stats.running,
      sub: stats.running > 0 ? t('scans.now') : undefined,
      accent: stats.running > 0 ? 'beast-stat-accent-red' : undefined,
    },
    {
      label: t('scans.inQueue'), value: stats.queued,
      accent: stats.queued > 0 ? 'beast-stat-accent-blue' : undefined,
    },
    {
      label: t('scans.paused'), value: stats.paused,
      accent: stats.paused > 0 ? 'beast-stat-accent-amber' : undefined,
    },
    {
      label: t('scans.completed'), value: stats.completed,
      sub: stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : undefined,
      accent: 'beast-stat-accent-green',
    },
    {
      label: t('scans.failed'), value: stats.failed,
      accent: stats.failed > 0 ? 'beast-stat-accent-red' : undefined,
    },
    {
      label: t('scans.avgDuration'),
      value: stats.avg_duration_sec ? formatDuration(stats.avg_duration_sec) : '--',
      accent: 'beast-stat-accent-violet',
    },
  ];

  return (
    <div className="beast-grid-7">
      {cards.map((card) => (
        <div key={card.label} className={cn('beast-stat beast-stat-accent', card.accent)}>
          <p className="beast-stat-label">{card.label}</p>
          <p className="beast-stat-value">{card.value}</p>
          {card.sub && <p className="beast-text-hint">{card.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Running Scans (live cards) ─────────────────────────────────

function RunningScans({ canEdit, highlightId }: { canEdit: boolean; highlightId?: string | null }) {
  const { t } = useTranslation();
  const { data: runningData } = useScans({ status: 'running', limit: 10 });
  const { data: pausedData } = useScans({ status: 'paused', limit: 10 });
  const cancelScan = useCancelScan();
  const active = [...(pausedData?.results ?? []), ...(runningData?.results ?? [])];
  if (active.length === 0) return null;

  return (
    <div>
      <h2 className="beast-card-title beast-flex beast-flex-gap-sm">
        <span className="beast-step-dot beast-step-dot-active" />
        {t('scans.currentlyRunning')}
      </h2>
      <div className="beast-stack-xs">
        {active.map((scan) => (
          <RunningScanCard
            key={scan.id}
            scan={scan}
            canEdit={canEdit}
            highlighted={highlightId === scan.id}
            onCancel={() => cancelScan.mutate(scan.id)}
          />
        ))}
      </div>
    </div>
  );
}

function RunningScanCard({ scan, canEdit, highlighted, onCancel }: { scan: ScanDetail; canEdit: boolean; highlighted?: boolean; onCancel: () => void }) {
  const { t } = useTranslation();
  const { data: detail } = useScanDetail(scan.id);
  const live = detail ?? scan;
  const steps = live.steps ?? [];
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);

  const elapsed = useLiveElapsed(live.startedAt);
  const currentStep = steps.find(s => s.status === 'running');
  // Display-stage progress: the three findings sub-steps count as ONE stage.
  const completedSteps = PIPELINE_STAGES.filter((stage) => {
    const st = displayStageStatus(stage.key, steps);
    return st === 'completed' || st === 'skipped';
  }).length;
  const isPaused = live.status === 'paused';

  return (
    <div ref={cardRef} className={cn('beast-running-card', isPaused && 'beast-running-card-paused', highlighted && 'beast-row-highlight')}>
      <div className="beast-running-card-row">
        <div className="beast-flex beast-flex-gap-sm">
          <span className="beast-running-icon">
            {isPaused ? '\u23F8' : '\u25B6'}
          </span>
          <div>
            <div className="beast-flex beast-flex-gap-sm">
              <p className="beast-running-name">{live.repoName}</p>
              <ScanTypeBadge scanType={live.scanType} />
            </div>
            <p className="beast-text-hint">
              {live.id.slice(0, 8)}
              {elapsed != null && <span> &middot; <span data-testid="live-elapsed">{formatDuration(elapsed)}</span> {t('scans.elapsed')}</span>}
            </p>
          </div>
        </div>
        <div className="beast-flex beast-flex-gap">
          <div>
            <p className="beast-running-step">{currentStep ? stageLabel(currentStep.stepName, t) : (isPaused ? t('scans.paused') : '...')}</p>
            <p className="beast-text-hint">{t('scans.stepsProgress', { completed: completedSteps, total: PIPELINE_STAGES.length })}</p>
          </div>
          {canEdit && (
            <button
              onClick={onCancel}
              title={t('scans.cancelScan')}
              className="beast-btn beast-btn-danger beast-btn-sm"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          )}
        </div>
      </div>

      {isPaused && <PauseBanner scan={live} canEdit={canEdit} />}

      {/* Pipeline step progress */}
      <div className="beast-running-card-body">
        <PipelineProgress steps={toPipelineSteps(steps, t)} />
      </div>
    </div>
  );
}

// \u2500\u2500 Pause banner: shows resumes-at countdown + Sniper module progress \u2500

function PauseBanner({ scan, canEdit }: { scan: ScanDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const countdown = useResumeCountdown(scan.resumesAt);
  const resumeScan = useResumeScan();
  const { completed, total } = scan.moduleProgress ?? { completed: 0, total: 0 };

  return (
    <div className="beast-pause-banner">
      <div className="beast-pause-banner-row">
        <div className="beast-pause-banner-icon">{'\u23F8'}</div>
        <div className="beast-pause-banner-text">
          <p className="beast-pause-banner-title">{t('scans.pausedBanner')}</p>
          <p className="beast-pause-banner-reason">{scan.error ?? t('scans.pausedReason')}</p>
        </div>
        {scan.resumesAt && (
          <div className="beast-pause-banner-countdown">
            <p className="beast-pause-banner-countdown-label">
              {countdown && countdown > 0 ? t('scans.resumesIn') : t('scans.resumesAt')}
            </p>
            <p className="beast-pause-banner-countdown-value">
              {countdown != null && countdown > 0
                ? formatCountdown(countdown)
                : formatDateTime(scan.resumesAt)}
            </p>
          </div>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => resumeScan.mutate(scan.id)}
            disabled={resumeScan.isPending}
            className="beast-btn beast-btn-warning beast-btn-sm"
            title={t('scans.resumeNow')}
          >
            {resumeScan.isPending ? t('scans.resuming') : t('scans.resumeNow')}
          </button>
        )}
      </div>

      {total > 0 && (
        <div className="beast-pause-banner-progress">
          <div className="beast-pause-banner-progress-row">
            <span className="beast-pause-banner-progress-label">{t('scans.snipeProgress')}</span>
            <span className="beast-pause-banner-progress-count">
              {t('scans.modulesCompleted', { completed, total })}
            </span>
          </div>
          <div className="beast-pause-banner-progress-track">
            <div
              className="beast-pause-banner-progress-fill"
              style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function useResumeCountdown(resumesAt: string | null): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!resumesAt) {
      setSecondsLeft(null);
      return;
    }
    const target = new Date(resumesAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((target - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [resumesAt]);
  return secondsLeft;
}

function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── Scan Table (shared for queued/completed/failed) ────────────

function ScanTable({ status, canEdit, highlightId }: { status: string; canEdit: boolean; highlightId?: string | null }) {
  const { t } = useTranslation();
  const { data, isLoading } = useScans({ status, limit: 200 });
  const removeScan = useRemoveScan();
  const [confirmRemove, setConfirmRemove] = useState<ScanDetail | null>(null);
  const scanList = data?.results ?? [];

  if (isLoading) return <TableSkeleton />;
  if (scanList.length === 0) {
    const msg = status === 'queued' ? t('scans.noScansInQueue')
      : status === 'completed' ? t('scans.noCompletedScans')
      : t('scans.noFailedScans');
    return <EmptyState text={msg} />;
  }

  const handleRemoveConfirmed = () => {
    if (!confirmRemove) return;
    removeScan.mutate(confirmRemove.id, { onSettled: () => setConfirmRemove(null) });
  };

  // Queue tab: the API returns queued scans in FIFO order (created_at asc),
  // so the row index IS the queue position.
  const isQueue = status === 'queued';

  return (
    <div className="beast-table-wrap">
      <table className="beast-table">
        <thead>
          <tr>
            {isQueue && <th className="beast-th-queue-pos">#</th>}
            <th>{t('scans.repository')}</th>
            <th>{t('common.status')}</th>
            <th>
              {status === 'failed' ? t('scans.error') : t('dashboard.duration')}
            </th>
            <th>{t('scans.steps')}</th>
            <th>
              {status === 'queued' ? t('scans.queuedAt') : status === 'completed' ? t('scans.completed') : t('scans.failedAt')}
            </th>
            {canEdit && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {scanList.map((scan, index) => (
            <ScanRow
              key={scan.id}
              scan={scan}
              canEdit={canEdit}
              highlighted={highlightId === scan.id}
              position={isQueue ? index + 1 : undefined}
              onRemove={() => setConfirmRemove(scan)}
            />
          ))}
        </tbody>
      </table>

      {/* Remove confirmation (same pattern as the repo delete dialog) */}
      {confirmRemove && (
        <div className="beast-overlay" onClick={() => setConfirmRemove(null)}>
          <div className="beast-modal beast-modal-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="beast-modal-title">{t('scans.removeScan')}</h3>
            <p className="beast-modal-body">
              {t('scans.removeScanConfirm')} <strong>{confirmRemove.repoName}</strong>?
            </p>
            <div className="beast-modal-actions">
              <button
                onClick={() => setConfirmRemove(null)}
                className="beast-btn beast-btn-outline beast-btn-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleRemoveConfirmed}
                disabled={removeScan.isPending}
                className="beast-btn beast-btn-danger beast-btn-sm"
              >
                {removeScan.isPending ? t('scans.removing') : t('common.remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScanRow({ scan, canEdit, highlighted, position, onRemove }: { scan: ScanDetail; canEdit: boolean; highlighted?: boolean; position?: number; onRemove: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { data: detail } = useScanDetail(expanded ? scan.id : null);
  const cancelScan = useCancelScan();
  const live = detail ?? scan;
  const steps = live.steps ?? [];
  const rowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (highlighted) {
      rowRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      // A ?scan= deep link should land the user IN the step detail, not just
      // at a briefly-highlighted collapsed row. Never auto-collapses.
      setExpanded(true);
    }
  }, [highlighted]);

  const dur = live.durationMs
    ? Math.round(live.durationMs / 1000)
    : live.startedAt && live.completedAt
    ? Math.round((new Date(live.completedAt).getTime() - new Date(live.startedAt).getTime()) / 1000)
    : null;

  const failedStep = steps.find(s => s.status === 'failed');
  // "Completed with errors": still status='completed', but some tools/modules
  // failed after retry \u2014 distinct amber icon/badge instead of the green check.
  const withErrors = live.status === 'completed' && !!live.completedWithErrors;
  const statusIcon = withErrors ? '\u26a0'
    : live.status === 'completed' ? '\u2713'
    : live.status === 'failed' ? '\u2717'
    : live.status === 'paused' ? '\u23f8'
    : '\u2022';
  const statusColor = withErrors ? 'status-paused'
    : live.status === 'completed' ? 'status-completed'
    : live.status === 'failed' ? 'status-failed'
    : live.status === 'paused' ? 'status-paused'
    : 'status-running';

  const timestamp = live.completedAt ?? live.createdAt;

  return (
    <>
      <tr
        ref={rowRef}
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'border-b border-th-border-subtle hover:bg-th-hover transition-colors cursor-pointer',
          expanded && 'bg-th-hover',
          highlighted && 'beast-row-highlight',
        )}
      >
        {position != null && (
          <td className="beast-td-queue-pos tabular-nums">{position}</td>
        )}
        <td>
          <div className="beast-flex beast-flex-gap-sm">
            <span className={cn('status-pill beast-flex-center beast-status-icon-sm', statusColor)}>
              {statusIcon}
            </span>
            <span className="beast-td-primary">{scan.repoName}</span>
            <ScanTypeBadge scanType={scan.scanType} />
          </div>
        </td>
        <td>
          <span
            className={cn(
              'status-pill',
              live.status === 'queued' && 'status-queued',
              live.status === 'running' && 'status-running',
              live.status === 'paused' && 'status-paused',
              live.status === 'completed' && (withErrors ? 'status-paused' : 'status-completed'),
              live.status === 'failed' && 'status-failed',
            )}
            title={withErrors ? t('scans.completedWithErrorsTooltip') : undefined}
          >
            {withErrors ? t('scans.completedWithErrors') : t(`status.${live.status}`)}
          </span>
        </td>
        <td>
          {live.status === 'failed'
            ? <span className="beast-td-code beast-td-code-truncate">{failedStep?.error ?? live.error ?? t('scans.unknown')}</span>
            : <span className="tabular-nums">{dur != null ? formatDuration(dur) : '--'}</span>
          }
        </td>
        <td>
          <MiniStepDots steps={steps} />
        </td>
        <td className="beast-td-date tabular-nums">
          {formatDateTime(timestamp)}
        </td>
        {canEdit && (
          <td>
            {live.status === 'queued' && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                title={t('scans.removeFromQueue')}
                className="beast-btn beast-btn-ghost"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            )}
            {(live.status === 'running' || live.status === 'paused') && (
              <button
                onClick={(e) => { e.stopPropagation(); cancelScan.mutate(scan.id); }}
                title={t('scans.cancelScan')}
                className="beast-btn beast-btn-ghost"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="4" width="8" height="8" /></svg>
              </button>
            )}
          </td>
        )}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5 + (canEdit ? 1 : 0) + (position != null ? 1 : 0)}>
            {steps.length > 0
              ? <StepTimelineDetail scanId={scan.id} steps={steps} error={live.error} stepErrors={live.stepErrors} />
              : <p className="beast-page-subtitle">{t('common.loading')}</p>
            }
          </td>
        </tr>
      )}
    </>
  );
}

// ── Scan Type Badge ────────────────────────────────────────────

function ScanTypeBadge({ scanType }: { scanType: string | null | undefined }) {
  const { t } = useTranslation();
  if (!scanType || scanType === 'full') return null;
  const label = scanType === 'pr' ? t('scans.types.pr') : scanType;
  return (
    <span className={cn(
      'beast-scan-type-badge',
      scanType === 'pr' && 'beast-scan-type-pr',
    )}>
      {label}
    </span>
  );
}

// ── Mini Step Dots ─────────────────────────────────────────────

function MiniStepDots({ steps }: { steps: ScanStep[] }) {
  const { t } = useTranslation();
  return (
    <div className="beast-flex beast-flex-gap-xs">
      {PIPELINE_STAGES.map((stage) => {
        const st = displayStageStatus(stage.key, steps);
        return (
          <div
            key={stage.key}
            title={`${t(stage.labelKey)}: ${t(`status.${st}`)}`}
            className={cn(
              'beast-step-dot beast-mini-dot',
              st === 'completed' && 'beast-step-dot-success',
              st === 'running' && 'beast-step-dot-running',
              st === 'failed' && 'beast-step-dot-failed',
              st === 'skipped' && 'beast-step-dot-skipped',
              st === 'pending' && 'beast-step-dot-pending',
            )}
          />
        );
      })}
    </div>
  );
}

// ── AI step log type map ───────────────────────────────────────

const AI_LOG_STEPS: Record<string, string> = {
  'analysis': 'analysis',
  'ai-research': 'ai-research',
  'triage-report': 'triage',
  'mitigation-check': 'mitigation',
};

// ── Step detail card (status, error, AI usage, input/output) ───

function StepDetailCard({ step, title }: { step: ScanStep; title: string }) {
  const { t } = useTranslation();
  const aiUsage = (step.output as Record<string, unknown> | null)?.aiUsage as Record<string, number> | undefined;
  const totalInput = aiUsage
    ? (aiUsage.inputTokens ?? 0) + (aiUsage.cacheReadInputTokens ?? 0) + (aiUsage.cacheCreationInputTokens ?? 0)
    : 0;

  return (
    <div className="beast-card beast-stack-sm">
      <div className="beast-flex-between">
        <h3 className="beast-card-title beast-card-title-flush">{title}</h3>
        <span className={cn(
          'status-pill',
          step.status === 'completed' && 'status-completed',
          step.status === 'failed' && 'status-failed',
          step.status === 'running' && 'status-running',
          step.status === 'skipped' && 'status-queued',
          step.status === 'pending' && 'status-queued',
        )}>
          {t(`status.${step.status}`)}
        </span>
      </div>

      {step.error && (
        <div className="beast-error">
          <p className="beast-code-inline">{step.error}</p>
        </div>
      )}

      {aiUsage && (
        <div className="beast-stat-row">
          <div className="beast-stat">
            <span className="beast-stat-value">${aiUsage.costUSD?.toFixed(3)}</span>
            <span className="beast-stat-label">{t('scans.aiUsage.cost')}</span>
          </div>
          <div className="beast-stat">
            <span className="beast-stat-value">{totalInput.toLocaleString()}</span>
            <span className="beast-stat-label">{t('scans.aiUsage.inputTokens')}</span>
          </div>
          <div className="beast-stat">
            <span className="beast-stat-value">{(aiUsage.outputTokens ?? 0).toLocaleString()}</span>
            <span className="beast-stat-label">{t('scans.aiUsage.outputTokens')}</span>
          </div>
          <div className="beast-stat">
            <span className="beast-stat-value">{(aiUsage.cacheReadInputTokens ?? 0).toLocaleString()}</span>
            <span className="beast-stat-label">{t('scans.aiUsage.cacheRead')}</span>
          </div>
          <div className="beast-stat">
            <span className="beast-stat-value">{aiUsage.model}</span>
            <span className="beast-stat-label">{t('scans.aiUsage.model')}</span>
          </div>
        </div>
      )}

      <div className="beast-grid-2">
        {step.input && (
          <div>
            <p className="beast-label">{t('scans.input')}</p>
            <pre className="beast-code-block">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          </div>
        )}
        {step.output && (
          <div>
            <p className="beast-label">{t('scans.output')}</p>
            <pre className="beast-code-block">
              {JSON.stringify(step.output, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {step.startedAt && (
        <p className="beast-text-hint tabular-nums">
          {t('scans.started')}: {formatDateTime(step.startedAt)}
          {step.completedAt && <> &middot; {t('scans.ended')}: {formatDateTime(step.completedAt)}</>}
        </p>
      )}
    </div>
  );
}

// ── Step Timeline Detail (expanded view with input/output) ─────

function StepTimelineDetail({ scanId, steps, error, stepErrors }: { scanId: string; steps: ScanStep[]; error: string | null; stepErrors?: ScanStepError[] }) {
  const { t } = useTranslation();
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [viewingLog, setViewingLog] = useState<string | null>(null);
  // The 'findings' display stage folds three backend steps — selecting it
  // shows one detail card per sub-step that has data.
  const selectedSubSteps = selectedStep === 'findings'
    ? FINDINGS_SUB_STEPS
      .map(name => steps.find(s => s.stepName === name))
      .filter((s): s is ScanStep => s != null)
    : [];
  const selected = steps.find(s => s.stepName === selectedStep);
  const { data: logs } = useScanLogs(scanId);

  const availableLogs = new Set(logs?.map(l => l.step) ?? []);

  return (
    <div className="beast-stack">
      {/* Reusable pipeline step progress */}
      <PipelineProgress
        size="lg"
        steps={toPipelineSteps(steps, t, true)}
        onStepClick={(key) => {
          setSelectedStep(selectedStep === key ? null : key);
          setViewingLog(null);
        }}
      />

      {/* "Completed with errors" details: every surviving (post-retry) failure,
          maximally detailed — tool/module name, error text, attempt info. */}
      {stepErrors && stepErrors.length > 0 && (
        <ScanStepErrorsSection stepErrors={stepErrors} />
      )}

      {/* AI log links */}
      {availableLogs.size > 0 && (
        <div className="beast-flex beast-flex-gap">
          {Object.entries(AI_LOG_STEPS).map(([stepKey, logKey]) => {
            if (!availableLogs.has(logKey)) return null;
            const labelKey = PIPELINE_STAGES.find(s => s.key === stepKey)?.labelKey
              ?? SUB_STAGE_LABEL_KEYS[stepKey];
            return (
              <button
                key={logKey}
                className={cn('beast-btn beast-btn-ghost beast-btn-sm', viewingLog === logKey && 'beast-btn-active')}
                onClick={() => setViewingLog(viewingLog === logKey ? null : logKey)}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 2h10v12H3z" /><path d="M5 5h6M5 8h6M5 11h4" />
                </svg>
                {t('scans.stepLog', { step: labelKey ? t(labelKey) : stepKey })}
              </button>
            );
          })}
        </div>
      )}

      {/* Log viewer */}
      {viewingLog && <LogViewer scanId={scanId} step={viewingLog} />}

      {/* Selected step detail panel. The 'findings' stage folds three backend
          sub-steps — show one card per sub-step so their individual progress
          stays visible inside the merged stage. */}
      {selectedStep === 'findings' && !viewingLog && selectedSubSteps.map(step => (
        <StepDetailCard key={step.stepName} step={step} title={t(SUB_STAGE_LABEL_KEYS[step.stepName] ?? step.stepName)} />
      ))}
      {selectedStep !== 'findings' && selected && !viewingLog && (
        <StepDetailCard step={selected} title={stageLabel(selected.stepName, t)} />
      )}

      {/* Pipeline-level error */}
      {error && !steps.some(s => s.error) && (
        <div className="beast-error">
          <p className="beast-code-inline">{error}</p>
        </div>
      )}
    </div>
  );
}

// ── Scan step errors (completed-with-errors detail) ────────────

function ScanStepErrorsSection({ stepErrors }: { stepErrors: ScanStepError[] }) {
  const { t } = useTranslation();
  return (
    <div className="beast-card beast-stack-sm" data-testid="scan-step-errors">
      <div>
        <h3 className="beast-card-title beast-card-title-flush beast-flex beast-flex-gap-sm">
          <span className="status-pill beast-flex-center beast-status-icon-sm status-paused">⚠</span>
          {t('scans.stepErrorsTitle')}
        </h3>
        <p className="beast-page-subtitle">{t('scans.stepErrorsSubtitle')}</p>
      </div>
      <div className="beast-stack-xs">
        {stepErrors.map((e, i) => (
          <div key={`${e.kind}-${e.name}-${i}`} className="beast-error">
            <div className="beast-flex beast-flex-gap-sm">
              <span className="beast-badge beast-badge-amber">
                {e.kind === 'module' ? t('scans.stepErrorModule') : t('scans.stepErrorTool')}
              </span>
              <span className="beast-td-primary">{e.name}</span>
              {e.failedAfterRetry && (
                <span className="beast-text-hint">({t('scans.failedAfterRetry')})</span>
              )}
            </div>
            <p className="beast-code-inline">{e.error}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Log Viewer ─────────────────────────────────────────────────

function LogViewer({ scanId, step }: { scanId: string; step: string }) {
  const { t } = useTranslation();
  const { data: raw, isLoading } = useScanLogContent(scanId, step);

  if (isLoading) return <div className="beast-skeleton beast-skeleton-block" />;
  if (!raw) return <p className="beast-text-hint">{t('scans.logNotAvailable')}</p>;

  // Parse NDJSON stream into readable entries
  const entries = raw.split('\n').filter(Boolean).map((line, i) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return { type: 'raw', text: line, _idx: i };
    }
  });

  return (
    <div className="beast-card beast-stack-sm">
      <div className="beast-flex-between">
        <h3 className="beast-card-title beast-card-title-flush">
          {t('scans.logTitle', { step: stageLabel(step, t) || step, count: entries.length })}
        </h3>
      </div>
      <div className="beast-log-viewer">
        {entries.map((entry, i) => (
          <LogEntry key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function LogEntry({ entry }: { entry: Record<string, unknown> }) {
  const { t } = useTranslation();
  const type = entry.type as string;

  if (type === 'assistant') {
    const msg = entry.message as Record<string, unknown> | undefined;
    if (msg?.type === 'tool_use') {
      return (
        <div className="beast-log-entry beast-log-tool">
          <span className="beast-log-tag">tool</span>
          <span className="beast-log-text">{msg.name as string}</span>
        </div>
      );
    }
    if (msg?.type === 'text') {
      const text = (msg.text as string || '').slice(0, 500);
      if (!text.trim()) return null;
      return (
        <div className="beast-log-entry beast-log-assistant">
          <span className="beast-log-tag">ai</span>
          <span className="beast-log-text">{text}</span>
        </div>
      );
    }
    return null;
  }

  if (type === 'result') {
    const dur = entry.duration_ms ?? entry.duration_api_ms;
    const modelUsage = entry.modelUsage as Record<string, Record<string, number>> | undefined;
    const usage = modelUsage ? Object.values(modelUsage)[0] : undefined;
    const cost = usage?.costUSD ?? entry.cost_usd ?? entry.total_cost_usd;
    return (
      <div className="beast-log-entry beast-log-result">
        <span className="beast-log-tag">done</span>
        <span className="beast-log-text">
          {entry.is_error ? t('scans.logError') : t('scans.logSuccess')}
          {cost != null && <> &middot; ${Number(cost).toFixed(3)}</>}
          {usage && <>
            &middot; {((usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0)).toLocaleString()} in
            &middot; {(usage.outputTokens ?? 0).toLocaleString()} out
          </>}
          {dur != null && <> &middot; {formatDuration(Math.round(Number(dur) / 1000))}</>}
        </span>
      </div>
    );
  }

  // Skip system/init and other noise
  return null;
}

// ── Shared Components ──────────────────────────────────────────

function EmptyState({ text }: { text: string }) {
  return (
    <div className="beast-empty">
      <p className="beast-empty-title">{text}</p>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="beast-stack-xs">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="beast-skeleton beast-skeleton-row" />
      ))}
    </div>
  );
}

// Localized duration units ("2m 14s" / "2 хв 14 с") — every caller lives in a
// component that re-renders on language change, so reading the global i18n
// instance here stays in sync.
function formatDuration(seconds: number): string {
  if (seconds < 60) return i18n.t('common.durationS', { s: seconds });
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return i18n.t('common.durationMS', { m: mins, s: secs });
  const hours = Math.floor(mins / 60);
  return i18n.t('common.durationHM', { h: hours, m: mins % 60 });
}
