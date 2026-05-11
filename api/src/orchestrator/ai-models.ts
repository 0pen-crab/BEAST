/** Valid model key values stored in workspace settings */
export const AI_MODEL_KEYS = ['opus', 'sonnet', 'haiku'] as const;
export type AiModelKey = (typeof AI_MODEL_KEYS)[number];

/** Map from short key to Claude CLI --model value */
const MODEL_MAP: Record<AiModelKey, string> = {
  opus: 'claude-opus-4-6[1m]',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

/**
 * Resolve a workspace model key to the Claude CLI --model flag value.
 * Falls back to `fallback` (default: 'opus') if key is unknown or empty.
 */
export function resolveModelFlag(key: string, fallback: AiModelKey = 'opus'): string {
  if (key && key in MODEL_MAP) return MODEL_MAP[key as AiModelKey];
  return MODEL_MAP[fallback];
}

/** Hardcoded model IDs for steps that are not user-configurable */
export const HARDCODED_MODELS = {
  feedback: MODEL_MAP.sonnet,
  highlights: MODEL_MAP.haiku,
} as const;
