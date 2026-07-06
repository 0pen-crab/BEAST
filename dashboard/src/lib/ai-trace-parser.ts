export interface PromptEvent {
  kind: 'prompt';
  content: string;
}

export interface SystemEvent {
  kind: 'system';
  subtype?: string;
  model?: string;
  cwd?: string;
  tools?: string[];
  sessionId?: string;
  raw: unknown;
}

export interface AssistantTextBlock {
  kind: 'text';
  text: string;
}
export interface AssistantThinkingBlock {
  kind: 'thinking';
  text: string;
}
export interface AssistantToolUseBlock {
  kind: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
export type AssistantBlock =
  | AssistantTextBlock
  | AssistantThinkingBlock
  | AssistantToolUseBlock;

export interface AssistantEvent {
  kind: 'assistant';
  blocks: AssistantBlock[];
  raw: unknown;
}

export interface ToolResultEvent {
  kind: 'tool_result';
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface ResultEvent {
  kind: 'result';
  isError: boolean;
  result: string;
  durationMs?: number;
  totalCostUsd?: number;
  numTurns?: number;
  model?: string;
  raw: unknown;
}

export interface TraceErrorEvent {
  kind: 'trace_error';
  message: string;
}

export interface UnknownEvent {
  kind: 'unknown';
  raw: unknown;
}

export type TraceEvent =
  | PromptEvent
  | SystemEvent
  | AssistantEvent
  | ToolResultEvent
  | ResultEvent
  | TraceErrorEvent
  | UnknownEvent;

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  try { return JSON.stringify(v); } catch { return String(v); }
}

function parseAssistantBlocks(message: unknown): AssistantBlock[] {
  if (!message || typeof message !== 'object') return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const out: AssistantBlock[] = [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    const obj = c as Record<string, unknown>;
    const type = obj.type;
    if (type === 'text' && typeof obj.text === 'string') {
      out.push({ kind: 'text', text: obj.text });
    } else if (type === 'thinking') {
      const text = typeof obj.thinking === 'string'
        ? obj.thinking
        : typeof obj.text === 'string' ? obj.text : '';
      out.push({ kind: 'thinking', text });
    } else if (type === 'tool_use') {
      out.push({
        kind: 'tool_use',
        id: typeof obj.id === 'string' ? obj.id : '',
        name: typeof obj.name === 'string' ? obj.name : '(tool)',
        input: obj.input ?? {},
      });
    }
  }
  return out;
}

function parseToolResult(message: unknown): ToolResultEvent | null {
  if (!message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const tr = content.find(c =>
    c && typeof c === 'object' && (c as { type?: string }).type === 'tool_result'
  );
  if (!tr || typeof tr !== 'object') return null;
  const obj = tr as Record<string, unknown>;
  let body: string;
  if (typeof obj.content === 'string') body = obj.content;
  else if (Array.isArray(obj.content)) {
    body = obj.content
      .map(c =>
        c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string'
          ? ((c as { text?: string }).text ?? '')
          : asString(c)
      )
      .join('\n');
  } else body = asString(obj.content);
  return {
    kind: 'tool_result',
    toolUseId: typeof obj.tool_use_id === 'string' ? obj.tool_use_id : '',
    content: body,
    isError: obj.is_error === true,
  };
}

/** Parse one already-trimmed non-empty jsonl line into a typed event. */
function parseLine(trimmed: string): TraceEvent {
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { kind: 'unknown', raw: trimmed };
  }
  if (!obj || typeof obj !== 'object') {
    return { kind: 'unknown', raw: obj };
  }
  const o = obj as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type : '';
  switch (type) {
    case 'prompt':
      return { kind: 'prompt', content: asString(o.content) };
    case 'trace_error':
      return { kind: 'trace_error', message: asString(o.message) };
    case 'system':
      return {
        kind: 'system',
        subtype: typeof o.subtype === 'string' ? o.subtype : undefined,
        model: typeof o.model === 'string' ? o.model : undefined,
        cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
        tools: Array.isArray(o.tools)
          ? o.tools.filter((t): t is string => typeof t === 'string')
          : undefined,
        sessionId: typeof o.session_id === 'string' ? o.session_id : undefined,
        raw: o,
      };
    case 'assistant':
      return {
        kind: 'assistant',
        blocks: parseAssistantBlocks(o.message),
        raw: o,
      };
    case 'user': {
      const tr = parseToolResult(o.message);
      if (tr) return tr;
      return { kind: 'unknown', raw: o };
    }
    case 'result':
      return {
        kind: 'result',
        isError: o.is_error === true,
        result: asString(o.result),
        durationMs: typeof o.duration_ms === 'number' ? o.duration_ms : undefined,
        totalCostUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : undefined,
        numTurns: typeof o.num_turns === 'number' ? o.num_turns : undefined,
        model: typeof o.model === 'string' ? o.model : undefined,
        raw: o,
      };
    default:
      return { kind: 'unknown', raw: o };
  }
}

/**
 * Parse the jsonl body persisted by `persistTrace` into a typed event timeline.
 * Tolerant of malformed lines — those become {kind:'unknown', raw:line}.
 * Every non-empty line yields exactly one event.
 */
export function parseStreamJsonl(content: string): TraceEvent[] {
  if (!content) return [];
  const out: TraceEvent[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(parseLine(trimmed));
  }
  return out;
}

export interface TraceSummary {
  /** Same count parseStreamJsonl would produce — one event per non-empty line. */
  eventCount: number;
  result: ResultEvent | null;
  hasTraceError: boolean;
}

const SUMMARY_CANDIDATE = /"type"\s*:\s*"(?:result|trace_error)"/;

/**
 * Cheap header-level summary of a trace. Multi-MB traces should NOT be fully
 * JSON-parsed just to render a collapsed wave header, so this only counts
 * non-empty lines and JSON-parses the few lines that can carry the final
 * `result` / `trace_error` marker (a regex pre-filter; the full parse of the
 * candidate line guards against the marker appearing inside string content).
 */
export function summarizeTrace(content: string): TraceSummary {
  const summary: TraceSummary = { eventCount: 0, result: null, hasTraceError: false };
  if (!content) return summary;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    summary.eventCount++;
    if (!SUMMARY_CANDIDATE.test(trimmed)) continue;
    const event = parseLine(trimmed);
    if (event.kind === 'result') summary.result = event;
    else if (event.kind === 'trace_error') summary.hasTraceError = true;
  }
  return summary;
}

/**
 * i18n descriptor for a wave label: either a translation key (+ interpolation
 * params) under `repo.aiTrace.wave.*`, or literal text for unknown wave keys
 * (title-cased so the UI never shows raw kebab).
 */
export type WaveLabel =
  | { key: string; params?: Record<string, string> }
  | { text: string };

export function waveLabel(wave: string): WaveLabel {
  if (wave === 'wave1') return { key: 'repo.aiTrace.wave.wave1' };
  if (wave === 'wave3') return { key: 'repo.aiTrace.wave.wave3' };
  if (wave === 'report') return { key: 'repo.aiTrace.wave.report' };
  if (wave === 'analyzer') return { key: 'repo.aiTrace.wave.analyzer' };
  if (wave === 'scanner') return { key: 'repo.aiTrace.wave.scanner' };
  if (wave === 'triage-report') return { key: 'repo.aiTrace.wave.triageReport' };
  if (wave.startsWith('wave2-')) return { key: 'repo.aiTrace.wave.wave2', params: { name: titleCase(wave.slice(6)) } };
  if (wave.startsWith('wave4-')) return { key: 'repo.aiTrace.wave.wave4', params: { name: wave.slice(6) } };
  if (wave.startsWith('scout-unclear-')) return { key: 'repo.aiTrace.wave.scout', params: { batch: wave.slice(14) } };
  if (wave.startsWith('sniper-')) return { key: 'repo.aiTrace.wave.sniper', params: { name: wave.slice(7).replace(/_/g, ' ') } };
  return { text: titleCase(wave) };
}

function titleCase(s: string): string {
  return s.split(/[-_\s]+/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join(' ');
}

/**
 * SDK stream noise hidden by the viewer: rate-limit telemetry lines and
 * thinking-token counters. They stay in the raw trace (copy/download) but
 * add nothing to a human reading the timeline.
 */
export function isNoiseEvent(e: TraceEvent): boolean {
  if (e.kind === 'system' && e.subtype === 'thinking_tokens') return true;
  if (
    e.kind === 'unknown' &&
    !!e.raw &&
    typeof e.raw === 'object' &&
    (e.raw as { type?: unknown }).type === 'rate_limit_event'
  ) return true;
  return false;
}

/**
 * Human download filename for a wave trace: the translated wave label with
 * filesystem-hostile characters stripped (falls back to "trace" when the
 * label is empty). "Скаут · пачка 1" → "Скаут - пачка 1.jsonl".
 */
export function traceDownloadName(labelText: string): string {
  const safe = labelText
    .replace(/\s*·\s*/g, ' - ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${safe || 'trace'}.jsonl`;
}
