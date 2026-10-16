/**
 * Postgres rejects the NUL character () in BOTH jsonb and text columns.
 * Tool output (SARIF snippets from minified/binary-ish files) can legitimately
 * contain NUL bytes — without sanitization a single such byte kills the whole
 * scan at the step-output write ("unsupported Unicode escape sequence"),
 * losing all prepared findings. Caught live on a real repo (sigap-planner).
 */

const NUL = '\u0000';
// eslint-disable-next-line no-control-regex
const NUL_RE = /\u0000/g;

/** Strip NUL characters from a string. */
export function stripNul(s: string): string {
  return s.includes(NUL) ? s.replace(NUL_RE, '') : s;
}

/**
 * Deep-copy `value` with every string NUL-stripped. Safe for anything that is
 * JSON-serializable (step outputs, event details, prepared plans). Non-plain
 * values (Dates etc.) are returned as-is.
 */
export function sanitizeForDb<T>(value: T): T {
  if (typeof value === 'string') return stripNul(value) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeForDb(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[stripNul(k)] = sanitizeForDb(v);
  }
  return out as unknown as T;
}

const MAX_SCAN_ERROR_LENGTH = 8_000;

/**
 * Make an error message safe to persist and render.
 * Drizzle embeds the FULL failed query AND its params into the error text —
 * for a staged-plan write that was a 9.9 MB scans.error row that froze every
 * page rendering it. Cut the params dump entirely and cap the length.
 */
export function sanitizeScanError(message: string): string {
  let msg = stripNul(message);
  const paramsIdx = msg.indexOf('params: ');
  if (paramsIdx !== -1) {
    msg = `${msg.slice(0, paramsIdx)}params: <omitted>`;
  }
  if (msg.length > MAX_SCAN_ERROR_LENGTH) {
    msg = `${msg.slice(0, MAX_SCAN_ERROR_LENGTH)}… (truncated, ${message.length} chars total)`;
  }
  return msg;
}

// ── API serialization trimming ───────────────────────────────
// sanitizeScanError above protects NEW writes; legacy rows (pre-sanitize
// 10MB error blobs) and staged-plan step outputs still live in the DB —
// storage is the resume mechanism and stays intact. The helpers below trim
// what gets SERVED so a scan list / detail response stays a few KB instead
// of tens of MB (QA measured 10.5MB for /scans?limit=10 and 21–30MB for
// /scans/:id, causing 30–60s renderer freezes).

const MAX_LIST_ERROR_LENGTH = 2_000;

/**
 * Truncate a scan error for LIST payloads. List rows only need enough of the
 * error for a table cell — the detail view serves the (already 8KB-capped)
 * full text.
 */
export function truncateScanErrorForList(error: string | null | undefined): string | null | undefined {
  if (error == null || error.length <= MAX_LIST_ERROR_LENGTH) return error;
  return `${error.slice(0, MAX_LIST_ERROR_LENGTH)}… (truncated)`;
}

const MAX_EVENT_MESSAGE_LENGTH = 4_000;

/** Make a scan-event message safe to persist: NUL-stripped and length-capped. */
export function truncateEventMessage(message: string): string {
  const msg = stripNul(message);
  if (msg.length <= MAX_EVENT_MESSAGE_LENGTH) return msg;
  return `${msg.slice(0, MAX_EVENT_MESSAGE_LENGTH)}… (truncated, ${message.length} chars total)`;
}

/** Staged-plan fields (see ImportOutput in orchestrator/pipeline-types.ts).
 *  These travel through scan_steps.output as the commit/resume mechanism and
 *  can reach ~10MB — they must never be serialized into API responses. */
const HEAVY_STEP_KEYS = new Set([
  'preparedFindings',
  'preparedTests',
  'resultFiles',
  'analyzerAssessments',
]);

const MAX_STEP_PAYLOAD_CHARS = 50_000;

/** Deep-copy with every heavy staged-plan key replaced by a summary marker. */
function omitHeavyStepKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(omitHeavyStepKeys);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (HEAVY_STEP_KEYS.has(k) && v !== null && typeof v === 'object') {
      out[k] = Array.isArray(v) ? `<omitted: ${v.length} items>` : '<omitted>';
    } else {
      out[k] = omitHeavyStepKeys(v);
    }
  }
  return out;
}

/**
 * Trim a scan step's `input`/`output` for API responses: replace staged-plan
 * fields with markers, then hard-cap the serialized size. The dashboard's
 * expanded step view renders whatever JSON comes back, so the trimmed shape
 * just needs to stay a plain object. Storage is NOT affected.
 */
export function trimStepPayloadForApi(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (payload === null || payload === undefined) return payload;
  const stripped = omitHeavyStepKeys(payload) as Record<string, unknown>;
  const json = JSON.stringify(stripped);
  if (json.length <= MAX_STEP_PAYLOAD_CHARS) return stripped;
  return {
    '<truncated>': `step payload was ${json.length} chars; capped at ${MAX_STEP_PAYLOAD_CHARS}`,
    preview: json.slice(0, MAX_STEP_PAYLOAD_CHARS),
  };
}
