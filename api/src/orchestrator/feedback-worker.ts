import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { contributors, contributorAssessments, workspaces } from '../db/schema.ts';
import { sshExec, sshWriteFile, getClaudeRunnerConfig, parseStreamJsonResult } from './ssh.ts';
import { getLanguageInstruction } from './prompt-languages.ts';

const POLL_INTERVAL = 5_000; // 5 seconds
let timer: ReturnType<typeof setInterval> | null = null;
let processing = false;

// In-memory queue with deduplication
const pending = new Set<number>();

export function queueFeedbackCompilation(contributorId: number): void {
  pending.add(contributorId);
}

async function processNext() {
  if (processing || pending.size === 0) return;
  processing = true;

  // Pick first from the set
  const contributorId = pending.values().next().value!;
  pending.delete(contributorId);

  try {
    console.log(`[feedback] Compiling feedback for contributor ${contributorId}`);
    await compileFeedback(contributorId);
    console.log(`[feedback] Feedback compiled for contributor ${contributorId}`);
  } catch (err) {
    console.error(`[feedback] Failed to compile feedback for contributor ${contributorId}:`, err instanceof Error ? err.message : err);
  } finally {
    processing = false;
  }
}

export async function compileFeedback(contributorId: number): Promise<void> {
  const assessments = await db
    .select({
      repoName: contributorAssessments.repoName,
      feedback: contributorAssessments.feedback,
      scoreSecurity: contributorAssessments.scoreSecurity,
      scoreQuality: contributorAssessments.scoreQuality,
      scorePatterns: contributorAssessments.scorePatterns,
      scoreTesting: contributorAssessments.scoreTesting,
      scoreInnovation: contributorAssessments.scoreInnovation,
    })
    .from(contributorAssessments)
    .where(eq(contributorAssessments.contributorId, contributorId))
    .orderBy(desc(contributorAssessments.assessedAt));

  const withFeedback = assessments.filter(a => a.feedback);
  if (withFeedback.length === 0) return;

  // Single assessment — use its feedback directly
  if (withFeedback.length === 1) {
    await db.update(contributors)
      .set({ feedback: withFeedback[0].feedback, updatedAt: new Date() })
      .where(eq(contributors.id, contributorId));
    return;
  }

  // Multiple assessments — compile via Claude
  const sections = withFeedback.map(a => {
    const avg = ((a.scoreSecurity ?? 0) + (a.scoreQuality ?? 0) + (a.scorePatterns ?? 0)
      + (a.scoreTesting ?? 0) + (a.scoreInnovation ?? 0)) / 5;
    return `## ${a.repoName} (avg score: ${avg.toFixed(1)}/10)\n\n${a.feedback}`;
  }).join('\n\n---\n\n');

  const [contrib] = await db.select({
    displayName: contributors.displayName,
    workspaceId: contributors.workspaceId,
  })
    .from(contributors)
    .where(eq(contributors.id, contributorId));

  // Resolve workspace language for the prompt
  let langInstruction = '';
  if (contrib?.workspaceId) {
    const [ws] = await db.select({ defaultLanguage: workspaces.defaultLanguage })
      .from(workspaces)
      .where(eq(workspaces.id, contrib.workspaceId));
    if (ws?.defaultLanguage) {
      langInstruction = getLanguageInstruction(ws.defaultLanguage);
    }
  }

  const prompt = [
    langInstruction,
    `You are writing a unified contributor profile for ${contrib?.displayName || 'a contributor'}. Below are individual code quality assessments from different repositories they have contributed to.`,
    '',
    `Write a single coherent narrative (200-500 words) that synthesizes patterns across all repositories. This must read as an organic profile about the person, NOT a list of per-repo summaries.`,
    '',
    `Requirements:`,
    `- Output the profile text directly as your response — do NOT write to a file`,
    `- Synthesize common strengths and weaknesses into unified themes`,
    `- Reference specific repositories as evidence, but weave them naturally into the narrative`,
    `- Identify growth trajectory — are they improving in certain areas across projects?`,
    `- End with 2-3 actionable recommendations`,
    `- Write in third person`,
    `- Do NOT repeat per-repo sections verbatim`,
    `- Do NOT use headers larger than ###`,
    `- Do NOT structure as "In repo X... In repo Y..." — instead group by skill/pattern`,
    '',
    `---`,
    '',
    sections,
  ].filter(Boolean).join('\n');

  try {
    // Write prompt to file via SFTP to avoid shell escaping issues with long prompts
    const promptPath = `/tmp/feedback-prompt-${contributorId}.txt`;
    await sshWriteFile(getClaudeRunnerConfig(), promptPath, prompt);
    const command = `cat ${promptPath} | claude -p --verbose --output-format stream-json --dangerously-skip-permissions && rm -f ${promptPath}`;
    const result = await sshExec(getClaudeRunnerConfig(), command);
    const { result: parsed } = parseStreamJsonResult(result.stdout);
    if (parsed.is_error) throw new Error(String(parsed.result));
    const compiled = String(parsed.result || '').trim();
    if (!compiled) throw new Error('Empty result from Claude');

    await db.update(contributors)
      .set({ feedback: compiled, updatedAt: new Date() })
      .where(eq(contributors.id, contributorId));
  } catch (err) {
    // Do NOT write fallback concatenation — it produces garbage profiles.
    // The per-repo assessments are still available individually.
    console.error(`[feedback] Claude compilation failed for contributor ${contributorId}, skipping profile update:`, err instanceof Error ? err.message : err);
  }
}

export function startFeedbackWorker(): void {
  if (timer) return;
  timer = setInterval(processNext, POLL_INTERVAL);
  console.log('[feedback] Contributor feedback worker started');
}

export function stopFeedbackWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[feedback] Contributor feedback worker stopped');
  }
}
