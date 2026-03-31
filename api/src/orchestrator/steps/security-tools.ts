import { writeFileSync } from 'node:fs';
import { sshExec, getSecurityToolsConfig } from '../ssh.ts';
import type { PipelineContext, StepInput, SecurityToolsOutput, ToolResult } from '../pipeline-types.ts';
import { getSecret } from '../../lib/vault.ts';
import { getWorkspaceTools } from '../entities.ts';
import { getToolByKey } from '../../lib/tool-registry.ts';

export interface ToolWarning {
  tool: string;
  level: 'info' | 'warning';
  message: string;
  details: Record<string, unknown>;
}

export interface SecurityToolsResult {
  summary: Record<string, unknown>;
  warnings: ToolWarning[];
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
    };
  }

  // Build env file content from vault secrets and write to shared volume
  const envLines: string[] = [];
  for (const key of enabledKeys) {
    const def = getToolByKey(key);
    if (!def) continue;
    for (const cred of def.credentials) {
      const value = await getSecret('workspace', ctx.workspaceId, cred.vaultLabel);
      if (value) envLines.push(`export ${cred.envVar}="${value}"`);
    }
  }

  const envFilePath = `${ctx.toolsDir}/.beast-env`;

  if (envLines.length > 0) {
    writeFileSync(envFilePath, envLines.join('\n'));
  }

  const sshConfig = getSecurityToolsConfig();
  const enabledStr = enabledKeys.join(',');
  const cmd = `/scripts/run-scans.sh ${ctx.resultsDir} ${ctx.repoPath} "${enabledStr}" "${envFilePath}"`;
  console.log(`[security-tools] SSH command: ${cmd}`);
  const result = await sshExec(sshConfig, cmd);
  console.log(`[security-tools] SSH exit=${result.code}, stdout=${result.stdout.length} chars, stderr=${result.stderr.length} chars`);
  if (result.stderr) console.log(`[security-tools] stderr: ${result.stderr.slice(0, 500)}`);

  if (result.code !== 0) {
    throw new Error(`Security tools failed (exit ${result.code}): ${result.stderr || '(empty)'}`);
  }

  let summary: Record<string, Record<string, unknown>> = {};
  const warnings: ToolWarning[] = [];

  try {
    const lines = (result.stdout || '').trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine);
    summary = parsed.tools || {};

    for (const [tool, info] of Object.entries(summary)) {
      const i = info as Record<string, unknown>;
      if (i.status === 'failed') {
        warnings.push({
          tool,
          level: 'warning',
          message: `${tool} failed (exit ${i.exit_code}): ${i.error || 'unknown error'}`,
          details: i,
        });
      } else if (i.status === 'skipped') {
        warnings.push({
          tool,
          level: 'info',
          message: `${tool} skipped: ${i.error || 'not configured'}`,
          details: i,
        });
      }
    }
  } catch {
    // If we can't parse the summary, continue without warnings
  }

  return { summary, warnings };
}

export async function runSecToolsStep({ ctx, prev }: StepInput): Promise<SecurityToolsOutput & { toolWarnings: ToolWarning[] }> {
  const start = Date.now();
  const result = await runSecurityTools(ctx);

  const toolResults: Record<string, ToolResult> = {};
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
  }

  return {
    toolResults,
    totalDurationMs: Date.now() - start,
    toolWarnings: result.warnings,
  };
}
