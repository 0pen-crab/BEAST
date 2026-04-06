import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, sql, inArray, getTableColumns } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { findings, tests, scans, repositories, workspaces } from '../db/schema.ts';
import { authorize } from '../lib/authorize.ts';
import { sshExec, sshWriteFile, sshReadFile, getClaudeRunnerConfig, parseStreamJsonResult, SSHTimeoutError } from '../orchestrator/ssh.ts';
import { getLanguageInstruction } from '../orchestrator/prompt-languages.ts';
import crypto from 'node:crypto';

// ── In-memory job store ──────────────────────────────────────

interface HighlightsJob {
  id: string;
  workspaceId: number;
  status: 'processing' | 'done' | 'failed';
  csvContent?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, HighlightsJob>();

// Clean up jobs older than 1 hour
function pruneJobs() {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

// ── CSV helpers ──────────────────────────────────────────────

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function cleanFilePath(raw: string): string {
  return raw.replace(/^file:\/\/\/workspace\/[^/]+\/repo\//, '');
}

interface FindingRow {
  id: number;
  repositoryName: string | null;
  title: string;
  severity: string;
  tool: string;
  status: string | null;
  description: string | null;
  filePath: string | null;
  line: number | null;
  cwe: number | null;
  cvssScore: number | null;
  codeSnippet: string | null;
  secretValue: string | null;
  createdAt: Date | null;
}

const CSV_HEADER = 'ID,Repository,Title,Severity,Tool,Status,File,Line,CWE,CVSS,Secret,Description,Created';

function buildFindingsCsv(rows: FindingRow[]): string {
  const lines: string[] = [CSV_HEADER];
  for (const f of rows) {
    const file = f.filePath ? cleanFilePath(f.filePath) : '';
    lines.push([
      f.id,
      csvEscape(f.repositoryName),
      csvEscape(f.title),
      f.severity,
      f.tool,
      f.status ?? 'open',
      csvEscape(file),
      f.line ?? '',
      f.cwe != null ? `CWE-${f.cwe}` : '',
      f.cvssScore ?? '',
      csvEscape(f.secretValue),
      csvEscape(f.description),
      f.createdAt ? new Date(f.createdAt).toISOString() : '',
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

// ── Claude analysis ──────────────────────────────────────────

const HIGHLIGHTS_INACTIVITY_MS = 120_000; // 2 min
const HIGHLIGHTS_MAX_MS = 300_000; // 5 min

async function runHighlightsAnalysis(jobId: string, csv: string, lang: string): Promise<string> {
  const config = getClaudeRunnerConfig();
  const dir = `/workspace/highlights/${jobId}`;

  // Create directory + write input CSV
  await sshExec(config, `mkdir -p ${dir}`);
  await sshWriteFile(config, `${dir}/findings.csv`, csv);

  const langLine = getLanguageInstruction(lang);
  const prompt = [
    langLine,
    `You are a security analyst. Read the findings CSV at ${dir}/findings.csv.`,
    '',
    'Your task:',
    '1. Analyze ALL findings in the CSV',
    '2. Select the most critical and interesting ones that deserve immediate attention',
    '3. Focus on: real exploitable vulnerabilities, exposed secrets, critical misconfigurations, high-CVSS issues',
    '4. Deprioritize: informational noise, low-severity style issues, duplicates',
    `5. Write ONLY a curated CSV file to ${dir}/curated.csv with the same columns as the input`,
    '6. Include 10-30 findings maximum — only the ones that truly matter',
    '7. Keep the exact same CSV format (same header row, same column order)',
    '',
    'Rules:',
    '- ALWAYS write the output CSV file, even if you select all findings',
    '- Do NOT add extra columns or change the format',
    '- Do NOT write anything else — just read the input CSV and write the curated CSV',
  ].filter(Boolean).join('\n');

  const command = `echo ${JSON.stringify(prompt)} | claude -p --verbose --output-format stream-json --dangerously-skip-permissions`;

  const result = await sshExec(config, command, {
    inactivityTimeoutMs: HIGHLIGHTS_INACTIVITY_MS,
    maxTimeoutMs: HIGHLIGHTS_MAX_MS,
  });

  const { result: parsed } = parseStreamJsonResult(result.stdout);
  if (parsed.is_error) {
    const msg = String(parsed.result ?? 'unknown error');
    if (msg.includes('Not logged in')) {
      throw new Error('Claude Code is not authenticated on claude-runner. Run: make auth');
    }
    throw new Error(`Highlights analysis failed: ${msg}`);
  }

  // Read the curated CSV back
  const curated = await sshReadFile(config, `${dir}/curated.csv`);
  if (!curated.trim()) {
    throw new Error('Claude produced an empty curated CSV');
  }

  // Cleanup
  sshExec(config, `rm -rf ${dir}`).catch(() => {});

  return curated;
}

// ── Routes ───────────────────────────────────────────────────

export const highlightsRoutes: FastifyPluginAsyncZod = async (app) => {

  // GET /api/highlights/latest — get most recent job for workspace
  app.get(
    '/highlights/latest',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().positive(),
        }),
      },
    },
    async (request) => {
      const { workspace_id } = request.query;
      await authorize(request, workspace_id, 'member');

      pruneJobs();

      // Find most recent job for this workspace
      let latest: HighlightsJob | null = null;
      for (const job of jobs.values()) {
        if (job.workspaceId !== workspace_id) continue;
        if (!latest || job.createdAt > latest.createdAt) latest = job;
      }

      if (!latest) return { job: null };

      return {
        job: {
          id: latest.id,
          status: latest.status,
          error: latest.error ?? null,
        },
      };
    },
  );

  // POST /api/highlights/generate — start async analysis
  app.post(
    '/highlights/generate',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().positive(),
        }),
      },
    },
    async (request) => {
      const { workspace_id } = request.query;
      await authorize(request, workspace_id, 'member');

      pruneJobs();

      // Fetch workspace language
      const [ws] = await db.select({ defaultLanguage: workspaces.defaultLanguage })
        .from(workspaces).where(eq(workspaces.id, workspace_id));
      const lang = ws?.defaultLanguage ?? 'en';

      // Fetch all open findings for this workspace (with repo names)
      const workspaceTestIds = db.select({ id: tests.id }).from(tests)
        .innerJoin(scans, eq(tests.scanId, scans.id))
        .where(eq(scans.workspaceId, workspace_id));

      const rows = await db.select({
        id: findings.id,
        repositoryName: repositories.name,
        title: findings.title,
        severity: findings.severity,
        tool: findings.tool,
        status: findings.status,
        description: findings.description,
        filePath: findings.filePath,
        line: findings.line,
        cwe: findings.cwe,
        cvssScore: findings.cvssScore,
        codeSnippet: findings.codeSnippet,
        secretValue: findings.secretValue,
        createdAt: findings.createdAt,
      }).from(findings)
        .leftJoin(repositories, eq(repositories.id, findings.repositoryId))
        .where(and(
          inArray(findings.testId, workspaceTestIds),
          eq(findings.status, 'open'),
        ));

      if (rows.length === 0) {
        return { error: 'no_findings', message: 'No open findings to analyze' };
      }

      const csv = buildFindingsCsv(rows);
      const jobId = crypto.randomUUID();

      const job: HighlightsJob = {
        id: jobId,
        workspaceId: workspace_id,
        status: 'processing',
        createdAt: Date.now(),
      };
      jobs.set(jobId, job);

      // Fire and forget — run analysis in background
      runHighlightsAnalysis(jobId, csv, lang)
        .then((curated) => {
          job.status = 'done';
          job.csvContent = curated;
        })
        .catch((err) => {
          console.error(`[highlights] Job ${jobId} failed:`, err);
          job.status = 'failed';
          job.error = err instanceof Error ? err.message : String(err);
        });

      return { jobId, findingsCount: rows.length };
    },
  );

  // GET /api/highlights/:id — check job status
  app.get(
    '/highlights/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          workspace_id: z.coerce.number().positive(),
        }),
      },
    },
    async (request, reply) => {
      const { workspace_id } = request.query;
      await authorize(request, workspace_id, 'member');

      const job = jobs.get(request.params.id);
      if (!job || job.workspaceId !== workspace_id) {
        return reply.status(404).send({ error: 'Job not found' });
      }

      return {
        id: job.id,
        status: job.status,
        error: job.error ?? null,
      };
    },
  );

  // GET /api/highlights/:id/download — download curated CSV
  app.get(
    '/highlights/:id/download',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          workspace_id: z.coerce.number().positive(),
        }),
      },
    },
    async (request, reply) => {
      const { workspace_id } = request.query;
      await authorize(request, workspace_id, 'member');

      const job = jobs.get(request.params.id);
      if (!job || job.workspaceId !== workspace_id) {
        return reply.status(404).send({ error: 'Job not found' });
      }
      if (job.status !== 'done' || !job.csvContent) {
        return reply.status(400).send({ error: 'Job not ready' });
      }

      const date = new Date().toISOString().slice(0, 10);
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="security-brief-${date}.csv"`)
        .send(job.csvContent);
    },
  );
};
