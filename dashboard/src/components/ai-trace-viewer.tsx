import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiTraces, isScanActive, type AiTraceFile } from '@/api/hooks';
import { parseStreamJsonl, summarizeTrace, waveLabel, isNoiseEvent, traceDownloadName } from '@/lib/ai-trace-parser';
import type {
  TraceEvent,
  AssistantEvent,
  AssistantBlock,
  SystemEvent,
  ToolResultEvent,
  ResultEvent,
} from '@/lib/ai-trace-parser';
import { downloadBlob } from '@/lib/export-findings';
import { Skeleton } from './skeleton';

interface AiTraceViewerProps {
  repositoryId: number;
}

/** Index of the most recently written trace — the wave that is "live" mid-scan. */
function newestTraceIndex(traces: AiTraceFile[]): number {
  let best = traces.length - 1;
  for (let i = 0; i < traces.length; i++) {
    if (traces[i].created_at > traces[best].created_at) best = i;
  }
  return best;
}

export function AiTraceViewer({ repositoryId }: AiTraceViewerProps) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useAiTraces(repositoryId);

  if (isLoading) {
    return <Skeleton className="beast-skeleton-block" />;
  }

  if (error) {
    return (
      <div className="beast-empty">
        <p className="beast-empty-title">{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }

  if (!data?.scan) {
    return (
      <div className="beast-empty">
        <p className="beast-empty-title">{t('repo.aiTrace.emptyNoScan')}</p>
      </div>
    );
  }

  const traces = data.traces ?? [];
  const live = isScanActive(data.scan.status);
  const activeIdx = live ? newestTraceIndex(traces) : 0;

  return (
    <div className="beast-stack-md">
      <ScanHeader scan={data.scan} live={live} />
      {traces.length === 0 ? (
        <div className="beast-empty">
          <p className="beast-empty-title">{t('repo.aiTrace.emptyNoTraces')}</p>
        </div>
      ) : (
        <div className="beast-trace-list">
          {traces.map((trace, idx) => (
            <WaveBlock
              key={trace.file_name}
              trace={trace}
              defaultOpen={idx === activeIdx}
              live={live && idx === activeIdx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScanHeader({ scan, live }: {
  scan: NonNullable<NonNullable<ReturnType<typeof useAiTraces>['data']>['scan']>;
  live: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="beast-trace-scan-header">
      <div className="beast-trace-scan-meta">
        <span className={`status-pill status-${scan.status}`}>{t(`status.${scan.status}`, scan.status)}</span>
        <span className="beast-text-muted">{scan.scan_type}</span>
        {live && (
          <span className="beast-trace-live beast-animate-pulse">{t('repo.aiTrace.live')}</span>
        )}
      </div>
      {scan.error && <div className="beast-trace-scan-error">{scan.error}</div>}
    </div>
  );
}

function WaveBlock({ trace, defaultOpen, live }: { trace: AiTraceFile; defaultOpen: boolean; live?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  // Cheap line-scan for the header; the full (expensive) parse of a multi-MB
  // trace is deferred until the wave is actually expanded.
  const summary = useMemo(() => summarizeTrace(trace.content), [trace.content]);
  const events = useMemo(
    () => (open ? parseStreamJsonl(trace.content) : null),
    [open, trace.content],
  );
  const result = summary.result;
  const failed = (result && result.isError) || summary.hasTraceError;
  const status = failed
    ? 'failed'
    : result
      ? 'completed'
      : 'partial';
  const label = waveLabel(trace.wave);

  const handleCopy = () => {
    navigator.clipboard?.writeText(trace.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    // Human filename from the (translated) wave label, not the internal wave
    // key — "Скаут · пачка 1.jsonl" instead of "scout-unclear-1.jsonl".
    const labelText = 'key' in label ? t(label.key, label.params) : label.text;
    downloadBlob(traceDownloadName(labelText), new Blob([trace.content], { type: 'application/x-ndjson' }));
  };

  return (
    <div className={`beast-trace-wave beast-trace-wave-${status}`}>
      <div className="beast-trace-wave-header-row">
        <button
          type="button"
          className="beast-trace-wave-header"
          onClick={() => setOpen(o => !o)}
        >
          <span className="beast-trace-wave-chevron">{open ? '▾' : '▸'}</span>
          <span className="beast-trace-wave-title">{'key' in label ? t(label.key, label.params) : label.text}</span>
          <span className={`status-pill status-${status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running'}`}>{t(`repo.aiTrace.status.${status}`)}</span>
          {live && status === 'partial' && (
            <span className="beast-trace-live beast-animate-pulse">{t('repo.aiTrace.live')}</span>
          )}
          {result?.durationMs != null && (
            <span className="beast-trace-wave-meta">{formatDuration(result.durationMs)}</span>
          )}
          {result?.model && (
            <span className="beast-trace-wave-meta">{shortenModel(result.model)}</span>
          )}
          <span className="beast-trace-wave-meta beast-trace-wave-event-count">
            {summary.eventCount} {t('repo.aiTrace.events')}
          </span>
        </button>
        <div className="beast-trace-wave-actions">
          <button
            type="button"
            className="beast-btn-icon"
            onClick={handleCopy}
            title={copied ? t('repo.aiTrace.copied') : t('repo.aiTrace.copyRaw')}
            aria-label={t('repo.aiTrace.copyRaw')}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button
            type="button"
            className="beast-btn-icon"
            onClick={handleDownload}
            title={t('repo.aiTrace.downloadRaw')}
            aria-label={t('repo.aiTrace.downloadRaw')}
          >
            <DownloadIcon />
          </button>
        </div>
      </div>
      {open && events && (
        <div className="beast-trace-wave-body">
          <EventTimeline events={events} />
        </div>
      )}
    </div>
  );
}

interface ToolPairing {
  /** tool_use id → its paired result (only ids that actually have a tool_use). */
  resultByToolId: Map<string, ToolResultEvent>;
  /** tool_result events consumed by pairing — skipped as standalone rows. */
  paired: Set<ToolResultEvent>;
}

function pairToolResults(events: TraceEvent[]): ToolPairing {
  const toolUseIds = new Set<string>();
  for (const e of events) {
    if (e.kind === 'assistant') {
      for (const b of e.blocks) {
        if (b.kind === 'tool_use' && b.id) toolUseIds.add(b.id);
      }
    }
  }
  const resultByToolId = new Map<string, ToolResultEvent>();
  const paired = new Set<ToolResultEvent>();
  for (const e of events) {
    if (e.kind !== 'tool_result') continue;
    if (e.toolUseId && toolUseIds.has(e.toolUseId) && !resultByToolId.has(e.toolUseId)) {
      resultByToolId.set(e.toolUseId, e);
      paired.add(e);
    }
  }
  return { resultByToolId, paired };
}

function EventTimeline({ events }: { events: TraceEvent[] }) {
  // Pair each tool_use with its tool_result so a tool call renders as ONE
  // unit (call + nested result), not two disconnected blocks.
  const pairing = useMemo(() => pairToolResults(events), [events]);
  // No final `result` event yet → the wave is still streaming; unanswered
  // tool calls show a "running…" pill instead of nothing.
  const waveComplete = events.some(e => e.kind === 'result');
  // Rate-limit telemetry / thinking-token counters stay in the raw trace but
  // are pure noise in the timeline.
  const visible = useMemo(() => events.filter(e => !isNoiseEvent(e)), [events]);
  return (
    <div className="beast-trace-events">
      {visible.map((event, idx) => (
        <EventRow key={idx} event={event} pairing={pairing} waveComplete={waveComplete} />
      ))}
    </div>
  );
}

function EventRow({ event, pairing, waveComplete }: {
  event: TraceEvent;
  pairing: ToolPairing;
  waveComplete: boolean;
}) {
  const { t } = useTranslation();
  switch (event.kind) {
    case 'prompt':
      return <PromptBlock content={event.content} />;
    case 'system':
      return <SystemPill event={event} />;
    case 'assistant':
      return <AssistantBlocks event={event} pairing={pairing} waveComplete={waveComplete} />;
    case 'tool_result':
      // Paired results render nested inside their tool_use block.
      if (pairing.paired.has(event)) return null;
      return <ToolResultRow event={event} />;
    case 'result':
      return <ResultBanner event={event} />;
    case 'trace_error':
      return (
        <div className="beast-trace-event beast-trace-event-error">
          <strong>{t('repo.aiTrace.traceError')}</strong> {event.message}
        </div>
      );
    case 'unknown':
    default:
      return (
        <div className="beast-trace-event beast-trace-event-unknown">
          <code>{typeof event.raw === 'string' ? event.raw : JSON.stringify(event.raw)}</code>
        </div>
      );
  }
}

function PromptBlock({ content }: { content: string }) {
  const { t } = useTranslation();
  return (
    <div className="beast-trace-event beast-trace-event-prompt">
      <div className="beast-trace-event-label">{t('repo.aiTrace.prompt')}</div>
      <CollapsiblePre text={content} />
    </div>
  );
}

function SystemPill({ event }: { event: SystemEvent }) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (event.subtype) parts.push(event.subtype);
  if (event.model) parts.push(shortenModel(event.model));
  if (event.tools?.length) parts.push(t('repo.aiTrace.toolsCount', { n: event.tools.length }));
  if (event.cwd) parts.push(event.cwd);
  return (
    <div className="beast-trace-event beast-trace-event-system">
      <span className="beast-trace-event-pill">{t('repo.aiTrace.system')}</span>
      <span className="beast-trace-event-system-text">{parts.join(' · ')}</span>
    </div>
  );
}

function AssistantBlocks({ event, pairing, waveComplete }: {
  event: AssistantEvent;
  pairing: ToolPairing;
  waveComplete: boolean;
}) {
  return (
    <>
      {event.blocks.map((block, idx) => (
        <AssistantBlockRow key={idx} block={block} pairing={pairing} waveComplete={waveComplete} />
      ))}
    </>
  );
}

function AssistantBlockRow({ block, pairing, waveComplete }: {
  block: AssistantBlock;
  pairing: ToolPairing;
  waveComplete: boolean;
}) {
  const { t } = useTranslation();
  if (block.kind === 'text') {
    return (
      <div className="beast-trace-event beast-trace-event-assistant">
        <div className="beast-trace-event-label">{t('repo.aiTrace.assistant')}</div>
        <div className="beast-trace-event-text-body">{block.text}</div>
      </div>
    );
  }
  if (block.kind === 'thinking') {
    return (
      <div className="beast-trace-event beast-trace-event-thinking">
        <div className="beast-trace-event-label">{t('repo.aiTrace.thinking')}</div>
        <div className="beast-trace-event-text-body">{block.text}</div>
      </div>
    );
  }
  // tool_use — one unit: the call plus its paired result nested underneath.
  const result = block.id ? pairing.resultByToolId.get(block.id) : undefined;
  return (
    <div className="beast-trace-event beast-trace-event-tool">
      <div className="beast-trace-event-tool-header">
        <span className="beast-trace-event-pill beast-trace-event-pill-tool">{t('repo.aiTrace.tool')}</span>
        <span className="beast-trace-event-tool-name">{block.name}</span>
        {result ? (
          <span className={`status-pill beast-badge-sm ${result.isError ? 'status-failed' : 'status-completed'}`}>
            {result.isError ? t('repo.aiTrace.status.failed') : t('repo.aiTrace.status.completed')}
          </span>
        ) : !waveComplete ? (
          <span className="status-pill beast-badge-sm status-running">{t('repo.aiTrace.toolPending')}</span>
        ) : null}
      </div>
      <CollapsiblePre text={stringifyInput(block.input)} />
      {result && (
        <div className={`beast-trace-tool-result-nested ${result.isError ? 'beast-trace-event-tool-result-error' : ''}`}>
          <div className="beast-trace-event-label">{t('repo.aiTrace.toolResult')}</div>
          <CollapsiblePre text={result.content} />
        </div>
      )}
    </div>
  );
}

function ToolResultRow({ event }: { event: ToolResultEvent }) {
  const { t } = useTranslation();
  return (
    <div className={`beast-trace-event beast-trace-event-tool-result ${event.isError ? 'beast-trace-event-tool-result-error' : ''}`}>
      <div className="beast-trace-event-label">{t('repo.aiTrace.toolResult')}</div>
      <CollapsiblePre text={event.content} />
    </div>
  );
}

function ResultBanner({ event }: { event: ResultEvent }) {
  const { t } = useTranslation();
  return (
    <div className={`beast-trace-event beast-trace-event-final ${event.isError ? 'beast-trace-event-final-error' : 'beast-trace-event-final-ok'}`}>
      <div className="beast-trace-event-label">{event.isError ? t('repo.aiTrace.failed') : t('repo.aiTrace.completed')}</div>
      <div className="beast-trace-event-final-meta">
        {event.durationMs != null && <span>{formatDuration(event.durationMs)}</span>}
        {/* totalCostUsd is intentionally NOT rendered — cost stays in the data/raw trace only */}
        {event.numTurns != null && <span>{event.numTurns} {t('repo.aiTrace.turns')}</span>}
      </div>
      {event.result && (
        <CollapsiblePre text={event.result} />
      )}
    </div>
  );
}

// Collapse thresholds: bodies longer than COLLAPSE_THRESHOLD lines (or a very
// large single-line payload) render only a preview until expanded, keeping
// the DOM small for multi-MB traces.
const COLLAPSE_THRESHOLD_LINES = 20;
const PREVIEW_LINES = 15;
const COLLAPSE_THRESHOLD_CHARS = 4_000;

function CollapsiblePre({ text }: { text: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const lineCount = useMemo(() => {
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
    return n;
  }, [text]);
  const collapsible = lineCount > COLLAPSE_THRESHOLD_LINES || text.length > COLLAPSE_THRESHOLD_CHARS;
  if (!collapsible) {
    return <pre className="beast-trace-event-pre">{text}</pre>;
  }
  let shown = text;
  if (!expanded) {
    shown = text.split('\n').slice(0, PREVIEW_LINES).join('\n');
    if (shown.length > COLLAPSE_THRESHOLD_CHARS) shown = shown.slice(0, COLLAPSE_THRESHOLD_CHARS);
    shown += '\n…';
  }
  return (
    <div className="beast-trace-collapsible">
      <pre className="beast-trace-event-pre">{shown}</pre>
      <button
        type="button"
        className="beast-trace-show-more"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? t('repo.aiTrace.showLess') : t('repo.aiTrace.showMore')}
      </button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg className="beast-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="1" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="beast-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="beast-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 4v11m0 0l-4-4m4 4l4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

function stringifyInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function shortenModel(model: string): string {
  // claude-opus-4-7-20250918 → opus 4.7
  const m = model.match(/claude-(opus|sonnet|haiku)-(\d)-(\d)/i);
  if (m) return `${m[1].toLowerCase()} ${m[2]}.${m[3]}`;
  return model;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  // Round to seconds first; rounding ms-fragments inside (ms % 60_000) can
  // produce "2m 60s" (179_999ms → floor=2, round(59999/1000)=60).
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}
