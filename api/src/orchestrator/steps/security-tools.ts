import { writeFileSync, chownSync } from 'node:fs';
import { sshExec, getSecurityToolsConfig } from '../ssh.ts';
import type { PipelineContext, StepInput, SecurityToolsOutput, ToolResult, ScanStepError } from '../pipeline-types.ts';
import { SCANNER_UID, SCANNER_GID } from '../pipeline-types.ts';
import { getSecret } from '../../lib/vault.ts';
import { getWorkspaceTools } from '../entities.ts';
import { getToolByKey } from '../../lib/tool-registry.ts';
import { logScanEvent } from '../pipeline.ts';

export interface ToolWarning {
  tool: string;
  level: 'info' | 'warning';
  message: string;
  details: Record<string, unknown>;
}

export interface SecurityToolsResult {
  summary: Record<string, unknown>;
  warnings: ToolWarning[];
  /** Summary keys of tools that got a second run-scans.sh pass (retry). */
  retriedTools: string[];
}

// run-scans.sh reports some tools under a different summary key than the
// workspace tool key its is_enabled() gate checks (jfrog → jf-audit). When a
// summary key fails and we build the retry pass's enabled-tools list, it must
// be translated back to the tool key or the retry would silently skip it.
const SUMMARY_KEY_TO_TOOL_KEY: Record<string, string> = {
  'jf-audit': 'jfrog',
};

type ToolSummary = Record<string, Record<string, unknown>>;

/**
 * One run-scans.sh pass for the given workspace tool keys: (re)creates the
 * credentials env file (run-scans.sh deletes it after sourcing, so every pass
 * needs a fresh one), runs the script over SSH, cleans up, and parses the
 * JSON summary from the last stdout line.
 *
 * Throws on SSH failure, non-zero exit, or an unparseable summary. For the
 * INITIAL pass an unparseable summary means the whole tool layer is lost —
 * an error event is logged and the scan fails. The RETRY pass throws a plain
 * error the caller downgrades (first-pass results are intact).
 */
async function runScanPass(
  ctx: PipelineContext,
  toolKeys: string[],
  isRetry: boolean,
): Promise<ToolSummary> {
  // Build env file content from vault secrets and write to shared volume
  const envLines: string[] = [];
  for (const key of toolKeys) {
    const def = getToolByKey(key);
    if (!def) continue;
    for (const cred of def.credentials) {
      const value = await getSecret('workspace', ctx.workspaceId, cred.vaultLabel);
      if (value) envLines.push(`export ${cred.envVar}="${value}"`);
    }
  }

  const envFilePath = `${ctx.toolsDir}/.beast-env`;

  if (envLines.length > 0) {
    // Owner-only perms: this file holds plaintext credentials on a shared
    // volume that the triage agent is later pointed at. The worker writes as
    // root, but run-scans.sh sources the file over SSH as the `scanner` user —
    // chown it to scanner or the tools step dies with "Permission denied".
    writeFileSync(envFilePath, envLines.join('\n'), { mode: 0o600 });
    try {
      chownSync(envFilePath, SCANNER_UID, SCANNER_GID);
    } catch (err) {
      // Non-fatal outside docker (dev on host); in docker the worker is root
      // and this must succeed — scream so a silent failure is visible.
      console.error(`[security-tools] Failed to chown ${envFilePath} to scanner: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const sshConfig = getSecurityToolsConfig();
  const enabledStr = toolKeys.join(',');
  const cmd = `/scripts/run-scans.sh ${ctx.resultsDir} ${ctx.repoPath} "${enabledStr}" "${envFilePath}"`;
  console.log(`[security-tools] SSH command${isRetry ? ' (retry pass)' : ''}: ${cmd}`);

  let result: Awaited<ReturnType<typeof sshExec>>;
  try {
    // Timeouts: run-scans.sh is the only long-running step in its parallel
    // group — a hung tool (semgrep/snyk on a network stall) used to leave the
    // scan `running` forever. Inactivity 60 min (trivy re-downloads its ~99 MiB
    // vuln DB through the throttled corporate proxy with no stdout once the
    // 24 h DB cache expires — 10 min was shorter than that download and killed
    // the whole step mid-fetch, so it never re-cached), hard cap 2 h.
    result = await sshExec(sshConfig, cmd, {
      signal: ctx.cancelSignal,
      inactivityTimeoutMs: 60 * 60_000,
      maxTimeoutMs: 120 * 60_000,
    });
  } finally {
    // Best-effort cleanup: run-scans.sh deletes the env file after sourcing it,
    // but on early failure (ssh drop, timeout, script crash before sourcing)
    // the plaintext credentials would otherwise persist in the shared scan dir.
    if (envLines.length > 0) {
      try {
        await sshExec(sshConfig, `rm -f "${envFilePath}"`);
      } catch (cleanupErr) {
        console.error(`[security-tools] Failed to clean up env file ${envFilePath}:`, cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
      }
    }
  }
  console.log(`[security-tools] SSH exit=${result.code}, stdout=${result.stdout.length} chars, stderr=${result.stderr.length} chars`);
  if (result.stderr) console.log(`[security-tools] stderr: ${result.stderr.slice(0, 500)}`);

  if (result.code !== 0) {
    throw new Error(`Security tools failed (exit ${result.code}): ${result.stderr || '(empty)'}`);
  }

  try {
    const lines = (result.stdout || '').trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine);
    return (parsed.tools || {}) as ToolSummary;
  } catch (parseErr) {
    const stdoutTail = (result.stdout || '').trim().slice(-1000);
    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[security-tools] Tool summary line was unparseable (${errMsg})${isRetry ? ' on retry pass' : ''}. stdout tail: ${stdoutTail.slice(-300)}`);
    if (isRetry) {
      // First-pass results are intact — the caller keeps them and the retried
      // tools just stay failed. Do NOT fail the scan for a broken retry pass.
      throw new Error(`Retry pass summary unparseable: ${errMsg}`);
    }
    // An unparseable INITIAL summary means EVERY tool result is lost — the scan
    // must FAIL, not "complete" with 0 findings and no explanation. Scream to
    // the Events page first, then throw (this step is required).
    await logScanEvent(
      ctx.scanId,
      'security-tools',
      'error',
      `Security tools summary was unparseable — tool results are lost, failing the scan. Parse error: ${errMsg}`,
      { stdoutTail },
      ctx.repoName,
      ctx.workspaceId,
    );
    throw new Error(`Security tools summary unparseable — tool results are lost: ${errMsg}`);
  }
}

// Anything that is neither success nor skipped counts as failed — the same
// notion runSecToolsStep uses when mapping the summary to ToolResult statuses.
// The retry gate must match it or oddball statuses (e.g. 'error') would be
// reported failed without ever getting their retry.
function isFailedStatus(info: Record<string, unknown>): boolean {
  return info.status !== 'success' && info.status !== 'skipped';
}

function failedSummaryKeys(summary: ToolSummary): string[] {
  return Object.entries(summary)
    .filter(([, info]) => isFailedStatus(info as Record<string, unknown>))
    .map(([key]) => key);
}

export async function runSecurityTools(ctx: PipelineContext): Promise<SecurityToolsResult> {
  console.log(`[security-tools] workspaceId=${ctx.workspaceId}, repoName=${ctx.repoName}`);
  const tools = await getWorkspaceTools(ctx.workspaceId);
  const enabledKeys = tools.filter(t => t.enabled).map(t => t.toolKey);
  console.log(`[security-tools] enabledKeys=[${enabledKeys.join(',')}] (${enabledKeys.length} tools)`);

  if (enabledKeys.length === 0) {
    console.log(`[security-tools] No tools enabled, skipping`);
    return {
      summary: {},
      warnings: [{ level: 'info', tool: 'all', message: 'No security tools enabled for this workspace', details: {} }],
      retriedTools: [],
    };
  }

  const summary = await runScanPass(ctx, enabledKeys, false);

  // Retry pass: failed enabled tools get ONE more run-scans.sh invocation with
  // only their keys. A tool that succeeds on retry replaces its failed summary
  // entry; its result FILE on the shared volume was overwritten by the rerun,
  // and the import step reads whatever files exist — merging statuses here is
  // what matters. Tools still failed after this stay failed and become
  // structured step errors (scan completes "with errors").
  const failedKeys = failedSummaryKeys(summary).filter(k => {
    const toolKey = SUMMARY_KEY_TO_TOOL_KEY[k] ?? k;
    return enabledKeys.includes(toolKey);
  });
  const retriedTools: string[] = [];

  if (failedKeys.length > 0) {
    const retryToolKeys = failedKeys.map(k => SUMMARY_KEY_TO_TOOL_KEY[k] ?? k);
    console.log(`[security-tools] ${failedKeys.length} tool(s) failed on the first pass — retrying once: ${retryToolKeys.join(',')}`);
    await logScanEvent(
      ctx.scanId, 'security-tools', 'info',
      `Retrying failed security tools once: ${retryToolKeys.join(', ')}`,
      { tools: retryToolKeys },
      ctx.repoName, ctx.workspaceId,
    );
    retriedTools.push(...failedKeys);

    try {
      const retrySummary = await runScanPass(ctx, retryToolKeys, true);
      for (const key of failedKeys) {
        if (retrySummary[key]) {
          const succeededNow = !isFailedStatus(retrySummary[key]);
          console.log(`[security-tools] ${key} retry → ${retrySummary[key].status}`);
          if (succeededNow) {
            await logScanEvent(
              ctx.scanId, 'security-tools', 'info',
              `${key} succeeded on retry`,
              { tool: key }, ctx.repoName, ctx.workspaceId,
            );
          }
          summary[key] = retrySummary[key];
        }
      }
    } catch (retryErr) {
      // The retry pass itself died (SSH drop, non-zero exit, unparseable retry
      // summary). First-pass results are intact — keep them; the retried tools
      // simply remain failed and surface as step errors. Never fail the scan
      // for a broken retry.
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      console.error(`[security-tools] Retry pass failed — keeping first-pass results: ${msg}`);
      await logScanEvent(
        ctx.scanId, 'security-tools', 'warning',
        `Security tools retry pass failed — the failed tools keep their first-pass errors: ${msg}`,
        { tools: failedKeys, error: msg },
        ctx.repoName, ctx.workspaceId,
      );
    }
  }

  const warnings: ToolWarning[] = [];
  for (const [tool, info] of Object.entries(summary)) {
    const i = info as Record<string, unknown>;
    // Failed tools are NOT added here — runSecToolsStep already emits a
    // dedicated 'error' scan event (+ toolErrors) per failure; a warning entry
    // would double-log the same incident in the Events tab.
    if (i.status === 'skipped') {
      warnings.push({
        tool,
        level: 'info',
        message: `${tool} skipped: ${i.error || 'not configured'}`,
        details: i,
      });
    }
  }

  return { summary, warnings, retriedTools };
}

export async function runSecToolsStep({ ctx, prev }: StepInput): Promise<SecurityToolsOutput & { toolWarnings: ToolWarning[] }> {
  const start = Date.now();
  const result = await runSecurityTools(ctx);

  const toolResults: Record<string, ToolResult> = {};
  const toolErrors: ScanStepError[] = [];
  for (const [tool, info] of Object.entries(result.summary)) {
    const i = info as Record<string, unknown>;
    const status = (i.status as string) === 'success'
      ? 'success'
      : (i.status as string) === 'skipped'
        ? 'skipped'
        : 'failed';
    toolResults[tool] = {
      status,
      durationMs: (i.duration_ms as number) || 0,
      findingsCount: (i.findings_count as number) || 0,
      error: i.error as string | undefined,
    };

    // Surface tool failures as scan events so they show up in the dashboard
    // events tab — silent failures (osv-scanner timeouts, semgrep crashes etc.)
    // were invisible before and just produced 0 findings without explanation.
    if (status === 'failed') {
      const retried = result.retriedTools.includes(tool);
      const errText = (i.error as string) || 'unknown error';
      await logScanEvent(
        ctx.scanId,
        'security-tools',
        'error',
        `${tool} failed${retried ? ' after retry' : ''}: ${errText}`,
        { tool, retried, durationMs: toolResults[tool].durationMs, raw: i },
        ctx.repoName,
        ctx.workspaceId,
      );

      // Maintainer policy (supersedes the old "failed tool → failed scan"):
      // tools that stay failed after their retry become structured step errors.
      // The step does NOT throw — the scan completes "with errors" and the
      // details are persisted on the scan + shown in the UI.
      toolErrors.push({
        kind: 'tool',
        name: tool,
        error: retried ? `failed after retry: ${errText}` : errText,
        failedAfterRetry: retried,
      });
    }
  }

  return {
    toolResults,
    totalDurationMs: Date.now() - start,
    toolWarnings: result.warnings,
    ...(toolErrors.length > 0 ? { toolErrors } : {}),
  };
}
