/** Valid model key values stored in workspace settings */
export const AI_MODEL_KEYS = ['opus', 'sonnet', 'haiku'] as const;
export type AiModelKey = (typeof AI_MODEL_KEYS)[number];

/**
 * A launchable model registry entry.
 *
 * MAINTAINER'S RULE: every model added to the registry MUST come with its
 * `contextWindow` taken from the official Anthropic model docs —
 * https://docs.anthropic.com/en/docs/about-claude/models — never guessed.
 * The required property below makes it impossible at the type level to add
 * or use a model without specifying its context window.
 */
export interface AiModelSpec {
  /** Claude CLI --model flag value (may carry the '[1m]' 1M-context suffix) */
  cliId: string;
  /**
   * Context window in tokens for the model AS LAUNCHED via `cliId`.
   * '[1m]'-suffixed CLI ids opt into the 1M-token beta window; plain ids get
   * the standard window. Source: https://docs.anthropic.com official docs.
   */
  contextWindow: number;
}

/**
 * Registry of models the orchestrator can launch, keyed by workspace model key.
 * Windows per official Anthropic docs (as of 2026):
 *   - Opus 4.6 / Sonnet 4.6 / Sonnet 5 / Haiku 4.5: 200K standard
 *   - The '[1m]' CLI suffix variants run the 1M-token beta window
 */
export const MODEL_REGISTRY: Record<AiModelKey, AiModelSpec> = {
  opus: { cliId: 'claude-opus-4-6[1m]', contextWindow: 1_000_000 },
  sonnet: { cliId: 'claude-sonnet-5[1m]', contextWindow: 1_000_000 },
  haiku: { cliId: 'claude-haiku-4-5-20251001', contextWindow: 200_000 },
};

/**
 * Standard (non-'[1m]') context windows by model family, for ids reported in
 * API responses (`modelUsage` keys). API ids never carry the CLI '[1m]'
 * suffix and may carry a '-YYYYMMDD' date suffix. Includes families we never
 * launch directly (e.g. internal routing models) so their usage still
 * resolves. Same maintainer's rule applies: values MUST come from
 * https://docs.anthropic.com/en/docs/about-claude/models — never guessed.
 */
const API_MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000, // 1M only in beta via header
  'claude-sonnet-5': 200_000, // 1M only via the '[1m]' CLI variant
  'claude-haiku-4-5': 200_000,
};

/** Split a model id into its family (no '[1m]', no date suffix) + 1M-flag. */
function normalizeModelId(modelId: string): { family: string; is1m: boolean } {
  const is1m = modelId.includes('[1m]');
  const family = modelId.replace(/\[1m\]/g, '').replace(/-\d{8}$/, '');
  return { family, is1m };
}

/** Window for an id resolved on its own form (with/without '[1m]'). */
function windowForId(modelId: string): number | undefined {
  const { family, is1m } = normalizeModelId(modelId);
  if (!family) return undefined;
  if (is1m) {
    // Explicit 1M variant — only valid if registered as a launchable '[1m]' model.
    for (const spec of Object.values(MODEL_REGISTRY)) {
      const cli = normalizeModelId(spec.cliId);
      if (cli.family === family && cli.is1m) return spec.contextWindow;
    }
    return undefined;
  }
  return API_MODEL_CONTEXT_WINDOWS[family];
}

/**
 * Resolve the context window (tokens) for a model id reported by the API.
 *
 * API `modelUsage` keys strip the CLI '[1m]' suffix, so a plain response id
 * (e.g. 'claude-sonnet-5' or 'claude-opus-4-6-20261101') can still belong to
 * a session launched with the 1M variant. When `launchedModelId` (the CLI
 * --model value the wave was actually launched with) is known and is the same
 * model family, it wins over the response id.
 *
 * Returns undefined for unknown models — callers must NOT fall back to a
 * silent 200K default; surface the gap loudly instead.
 */
export function contextWindowForModel(apiModelId: string, launchedModelId?: string): number | undefined {
  const api = normalizeModelId(apiModelId);

  if (launchedModelId) {
    const launched = normalizeModelId(launchedModelId);
    if (launched.family === api.family) {
      const launchedWindow = windowForId(launchedModelId);
      if (launchedWindow !== undefined) return launchedWindow;
      // Launched id unknown — fall through to resolving the API id on its own.
    }
  }

  return windowForId(apiModelId);
}

/**
 * Resolve a workspace model key to the Claude CLI --model flag value.
 * Falls back to `fallback` (default: 'opus') if key is unknown or empty.
 */
export function resolveModelFlag(key: string, fallback: AiModelKey = 'opus'): string {
  if (key && key in MODEL_REGISTRY) return MODEL_REGISTRY[key as AiModelKey].cliId;
  return MODEL_REGISTRY[fallback].cliId;
}

/** Hardcoded model IDs for steps that are not user-configurable */
export const HARDCODED_MODELS = {
  feedback: MODEL_REGISTRY.sonnet.cliId,
  highlights: MODEL_REGISTRY.haiku.cliId,
} as const;
