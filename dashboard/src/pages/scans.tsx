import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '@/components/error-boundary';
import { useScans, useScanDetail, useScanStats, useScanLogs, useScanLogContent, useCancelScan, useRemoveScan } from '@/api/hooks';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useCurrentWorkspaceRole, canWrite } from '@/lib/permissions';
import { PipelineProgress, type PipelineStep } from '@/components/pipeline-progress';
import { formatDateTime } from '@/lib/format';
import type { ScanDetail, ScanStep } from '@/api/types';

const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: 'clone', label: 'Clone Repo' },
  { key: 'analysis', label: 'Repo Analysis' },
  { key: 'security-tools', label: 'Security Tools' },
  { key: 'ai-research', label: 'AI Research' },
  { key: 'import', label: 'Import Findings' },
  { key: 'triage-report', label: 'Triage & Report' },
];

/** Map scan steps to PipelineProgress steps */
function toPipelineSteps(scanSteps: ScanStep[], showDurations?: boolean): PipelineStep[] {
  return PIPELINE_STAGES.map((stage) => {
    const step = scanSteps.find(s => s.stepName === stage.key);
    const status = step?.status ?? 'pending';

    let sublabel: string | undefined;
    if (showDurations && step?.startedAt && step?.completedAt) {
      const dur = Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000);
      sublabel = formatDuration(dur);
    }

    return {
      key: stage.key,
      label: stage.label,
      status: status === 'running' ? 'running'
        : status === 'completed' ? 'completed'
        : status === 'failed' ? 'failed'
        : status === 'skipped' ? 'skipped'
        : 'pending',
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
  const [tab, setTab] = useState<'active' | 'completed' | 'failed'>('active');
  const { user } = useAuth();
  const wsRole = useCurrentWorkspaceRole();
  const canEdit = user ? canWrite(user.role, wsRole ?? undefined) : false;

  return (
    <ErrorBoundary>
      <div className="beast-stack-md">
        <div>
          <h1 className="beast-page-title">{t('scans.title')}</h1>
          <p className="beast-page-subtitle">{t('scans.subtitle')}</p>
        </div>

        <StatsBar />
        <RunningScans canEdit={canEdit} />

        <div>
          <div className="beast-tab-bar beast-tab-bar-spaced">
            {(['active', 'completed', 'failed'] as const).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={cn('beast-tab', tab === tabKey && 'beast-tab-active')}
              >
                {tabKey === 'active' ? t('scans.queue') : tabKey === 'completed' ? t('scans.completed') : t('scans.failed')}
              </button>
            ))}
          </div>

          {tab === 'active' && <ScanTable status="queued" canEdit={canEdit} />}
          {tab === 'completed' && <ScanTable status="completed" canEdit={canEdit} />}
          {tab === 'failed' && <ScanTable status="failed" canEdit={canEdit} />}
        </div>
      </div>
    </ErrorBoundary>
  );
}

// ── Stats Bar ──────────────────────────────────────────────────

function StatsBar() {
  const { t } = useTranslation();
  const { data: stats } = useScanStats();
  if (!stats) return null;

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
    <div className="beast-grid-6">
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

function RunningScans({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const { data } = useScans({ status: 'running', limit: 10 });
  const cancelScan = useCancelScan();
  const running = data?.results ?? [];
  if (running.length === 0) return null;

  return (
    <div>
      <h2 className="beast-card-title beast-flex beast-flex-gap-sm">
        <span className="beast-step-dot beast-step-dot-active" />
        {t('scans.currentlyRunning')}
      </h2>
      <div className="beast-stack-xs">
        {running.map((scan) => (
          <RunningScanCard key={scan.id} scan={scan} canEdit={canEdit} onCancel={() => cancelScan.mutate(scan.id)} />
        ))}
      </div>
    </div>
  );
}

function RunningScanCard({ scan, canEdit, onCancel }: { scan: ScanDetail; canEdit: boolean; onCancel: () => void }) {
  const { data: detail } = useScanDetail(scan.id);
  const live = detail ?? scan;
  const steps = live.steps ?? [];

  const elapsed = useLiveElapsed(live.startedAt);
  const currentStep = steps.find(s => s.status === 'running');
  const completedSteps = steps.filter(s => s.status === 'completed').length;

  return (
    <div className="beast-running-card">
      <div className="beast-running-card-row">
        <div className="beast-flex beast-flex-gap-sm">
          <span className="beast-running-icon">
            {'\u25B6'}
          </span>
          <div>
            <p className="beast-running-name">{live.repoName}</p>
            <p className="beast-text-hint">
              {live.id.slice(0, 8)}
              {elapsed != null && <span> &middot; <span data-testid="live-elapsed">{formatDuration(elapsed)}</span> elapsed</span>}
            </p>
          </div>
        </div>
        <div className="beast-flex beast-flex-gap">
          <div>
            <p className="beast-running-step">{currentStep?.stepName ?? '...'}</p>
            <p className="beast-text-hint">{completedSteps}/{PIPELINE_STAGES.length} steps</p>
          </div>
          {canEdit && (
            <button
              onClick={onCancel}
              title="Cancel scan"
              className="beast-btn beast-btn-danger beast-btn-sm"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Pipeline step progress */}
      <div className="beast-running-card-body">
        <PipelineProgress steps={toPipelineSteps(steps)} />
      </div>
    </div>
  );
}

// ── Scan Table (shared for queued/completed/failed) ────────────

function ScanTable({ status, canEdit }: { status: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const { data, isLoading } = useScans({ status, limit: 200 });
  const scanList = data?.results ?? [];

  if (isLoading) return <TableSkeleton />;
  if (scanList.length === 0) {
    const msg = status === 'queued' ? t('scans.noScansInQueue')
      : status === 'completed' ? t('scans.noCompletedScans')
      : t('scans.noFailedScans');
    return <EmptyState text={msg} />;
  }

  return (
    <div className="beast-table-wrap">
      <table className="beast-table">
        <thead>
          <tr>
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
          {scanList.map((scan) => (
            <ScanRow key={scan.id} scan={scan} canEdit={canEdit} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScanRow({ scan, canEdit }: { scan: ScanDetail; canEdit: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { data: detail } = useScanDetail(expanded ? scan.id : null);
  const removeScan = useRemoveScan();
  const cancelScan = useCancelScan();
  const live = detail ?? scan;
  const steps = live.steps ?? [];

  const dur = live.durationMs
    ? Math.round(live.durationMs / 1000)
    : live.startedAt && live.completedAt
    ? Math.round((new Date(live.completedAt).getTime() - new Date(live.startedAt).getTime()) / 1000)
    : null;

  const failedStep = steps.find(s => s.status === 'failed');
  const statusIcon = live.status === 'completed' ? '\u2713' : live.status === 'failed' ? '\u2717' : '\u2022';
  const statusColor = live.status === 'completed' ? 'status-completed'
    : live.status === 'failed' ? 'status-failed'
    : 'status-running';

  const timestamp = live.completedAt ?? live.createdAt;

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'border-b border-th-border-subtle hover:bg-th-hover transition-colors cursor-pointer',
          expanded && 'bg-th-hover',
        )}
      >
        <td>
          <div className="beast-flex beast-flex-gap-sm">
            <span className={cn('status-pill beast-flex-center beast-status-icon-sm', statusColor)}>
              {statusIcon}
            </span>
            <span className="beast-td-primary">{scan.repoName}</span>
          </div>
        </td>
        <td>
          <span className={cn(
            'status-pill',
            live.status === 'queued' && 'status-queued',
            live.status === 'running' && 'status-running',
            live.status === 'completed' && 'status-completed',
            live.status === 'failed' && 'status-failed',
          )}>
            {live.status}
          </span>
        </td>
        <td>
          {live.status === 'failed'
            ? <span className="beast-td-code beast-td-code-truncate">{failedStep?.error ?? live.error ?? 'Unknown'}</span>
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
                onClick={(e) => { e.stopPropagation(); removeScan.mutate(scan.id); }}
                title="Remove"
                className="beast-btn beast-btn-ghost"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            )}
            {live.status === 'running' && (
              <button
                onClick={(e) => { e.stopPropagation(); cancelScan.mutate(scan.id); }}
                title="Cancel"
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
          <td colSpan={canEdit ? 6 : 5}>
            {steps.length > 0
              ? <StepTimelineDetail scanId={scan.id} steps={steps} error={live.error} />
              : <p className="beast-page-subtitle">Loading...</p>
            }
          </td>
        </tr>
      )}
    </>
  );
}

// ── Mini Step Dots ─────────────────────────────────────────────

function MiniStepDots({ steps }: { steps: ScanStep[] }) {
  return (
    <div className="beast-flex beast-flex-gap-xs">
      {PIPELINE_STAGES.map((stage) => {
        const step = steps.find(s => s.stepName === stage.key);
        const st = step?.status ?? 'pending';
        return (
          <div
            key={stage.key}
            title={`${stage.label}: ${st}`}
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
};

// ── Step Timeline Detail (expanded view with input/output) ─────

function StepTimelineDetail({ scanId, steps, error }: { scanId: string; steps: ScanStep[]; error: string | null }) {
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [viewingLog, setViewingLog] = useState<string | null>(null);
  const selected = steps.find(s => s.stepName === selectedStep);
  const { data: logs } = useScanLogs(scanId);

  const availableLogs = new Set(logs?.map(l => l.step) ?? []);

  return (
    <div className="beast-stack">
      {/* Reusable pipeline step progress */}
      <PipelineProgress
        size="lg"
        steps={toPipelineSteps(steps, true)}
        onStepClick={(key) => {
          setSelectedStep(selectedStep === key ? null : key);
          setViewingLog(null);
        }}
      />

      {/* AI log links */}
      {availableLogs.size > 0 && (
        <div className="beast-flex beast-flex-gap">
          {Object.entries(AI_LOG_STEPS).map(([stepKey, logKey]) => {
            if (!availableLogs.has(logKey)) return null;
            const stage = PIPELINE_STAGES.find(s => s.key === stepKey);
            return (
              <button
                key={logKey}
                className={cn('beast-btn beast-btn-ghost beast-btn-sm', viewingLog === logKey && 'beast-btn-active')}
                onClick={() => setViewingLog(viewingLog === logKey ? null : logKey)}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 2h10v12H3z" /><path d="M5 5h6M5 8h6M5 11h4" />
                </svg>
                {stage?.label ?? stepKey} log
              </button>
            );
          })}
        </div>
      )}

      {/* Log viewer */}
      {viewingLog && <LogViewer scanId={scanId} step={viewingLog} />}

      {/* Selected step detail panel */}
      {selected && !viewingLog && (
        <div className="beast-card beast-stack-sm">
          <div className="beast-flex-between">
            <h3 className="beast-card-title beast-card-title-flush">{selected.stepName}</h3>
            <span className={cn(
              'status-pill',
              selected.status === 'completed' && 'status-completed',
              selected.status === 'failed' && 'status-failed',
              selected.status === 'running' && 'status-running',
              selected.status === 'skipped' && 'status-queued',
              selected.status === 'pending' && 'status-queued',
            )}>
              {selected.status}
            </span>
          </div>

          {selected.error && (
            <div className="beast-error">
              <p className="beast-code-inline">{selected.error}</p>
            </div>
          )}

          <div className="beast-grid-2">
            {selected.input && (
              <div>
                <p className="beast-label">Input</p>
                <pre className="beast-code-block">
                  {JSON.stringify(selected.input, null, 2)}
                </pre>
              </div>
            )}
            {selected.output && (
              <div>
                <p className="beast-label">Output</p>
                <pre className="beast-code-block">
                  {JSON.stringify(selected.output, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {selected.startedAt && (
            <p className="beast-text-hint tabular-nums">
              Started: {formatDateTime(selected.startedAt)}
              {selected.completedAt && <> &middot; Ended: {formatDateTime(selected.completedAt)}</>}
            </p>
          )}
        </div>
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

// ── Log Viewer ─────────────────────────────────────────────────

function LogViewer({ scanId, step }: { scanId: string; step: string }) {
  const { data: raw, isLoading } = useScanLogContent(scanId, step);

  if (isLoading) return <div className="beast-skeleton beast-skeleton-block" />;
  if (!raw) return <p className="beast-text-hint">Log not available</p>;

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
          {step} log ({entries.length} events)
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
    const cost = entry.cost_usd ?? entry.total_cost_usd;
    const dur = entry.duration_ms ?? entry.duration_api_ms;
    return (
      <div className="beast-log-entry beast-log-result">
        <span className="beast-log-tag">done</span>
        <span className="beast-log-text">
          {entry.is_error ? 'Error' : 'Success'}
          {cost != null && <> &middot; ${Number(cost).toFixed(3)}</>}
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
