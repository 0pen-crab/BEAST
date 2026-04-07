import { sshExec, getClaudeRunnerConfig, parseStreamJsonResult, SSHTimeoutError } from '../ssh.ts';
import type { PipelineContext, StepInput, AiResearchOutput } from '../pipeline-types.ts';
import { AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS } from '../pipeline-types.ts';
import { getLanguageInstruction } from '../prompt-languages.ts';
import { addScanFile } from '../entities.ts';

export async function runScanner(ctx: PipelineContext): Promise<{ cost?: number; durationMs?: number; log: string }> {
  const langLine = getLanguageInstruction(ctx.reportLanguage);
  const scanTarget = ctx.commitHash
    ? `Scan files changed in commit ${ctx.commitHash} in the repository at ${ctx.repoPath}`
    : `Scan the repository at ${ctx.repoPath}`;

  const prompt = [
    langLine,
    `${scanTarget} for security vulnerabilities.`,
    '',
    `Read the profile first: ${ctx.profilePath}`,
    `Write SARIF output to: ${ctx.resultsDir}/code-analysis.sarif`,
    '',
    `Rules:`,
    `- Read the profile BEFORE scanning — it has architecture, trust boundaries, and scan strategy`,
    `- Be aggressive — flag anything suspicious, use confidence levels`,
    `- ALWAYS write the SARIF file, even if zero vulnerabilities found`,
  ].filter(Boolean).join('\n');
  const command = `echo ${JSON.stringify(prompt)} | claude -p --verbose --append-system-prompt-file /prompts/scanner.md --output-format stream-json --dangerously-skip-permissions`;

  const result = await sshExec(getClaudeRunnerConfig(), command, {
    inactivityTimeoutMs: AI_INACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: AI_MAX_TIMEOUT_MS,
  });

  const { result: parsed, log } = parseStreamJsonResult(result.stdout);

  if (parsed.is_error) {
    const msg = String(parsed.result ?? 'unknown error');
    if (msg.includes('Not logged in')) {
      throw new Error('Claude Code is not authenticated on claude-runner. Run: make claude-login');
    }
    throw new Error(`Scanner failed: ${msg}`);
  }

  // stream-json result event is authoritative — don't check exit code if result says success
  return {
    cost: parsed.total_cost_usd as number | undefined,
    durationMs: parsed.duration_ms as number | undefined,
    log,
  };
}

export async function runAiResearchStep({ ctx, prev }: StepInput): Promise<AiResearchOutput> {
  if (!ctx.aiScanningEnabled) {
    console.log(`[ai-research] AI scanning disabled for workspace ${ctx.workspaceId}, skipping`);
    return { scanCompleted: false, skipped: true, durationMs: 0 };
  }
  if (!prev.aiAvailable) {
    return { scanCompleted: false, skipped: true, durationMs: 0 };
  }
  const start = Date.now();
  try {
    const result = await runScanner(ctx);
    await addScanFile({ scanId: ctx.scanId, fileName: 'ai-research.log', fileType: 'log-ai-research', content: result.log });
    return {
      scanCompleted: true,
      skipped: false,
      durationMs: Date.now() - start,
      cost: result.cost,
    };
  } catch (err) {
    // Save partial log even on timeout
    if (err instanceof SSHTimeoutError && err.stdout) {
      await addScanFile({ scanId: ctx.scanId, fileName: 'ai-research.log', fileType: 'log-ai-research', content: err.stdout }).catch(() => {});
    }
    throw err;
  }
}
