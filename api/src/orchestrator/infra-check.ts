import { eq, and, like } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scanEvents } from '../db/schema.ts';
import {
  sshExec,
  getSecurityToolsConfig,
  getClaudeRunnerConfig,
  type SSHConfig,
} from './ssh.ts';
import { listWorkspaces } from './entities.ts';

interface InfraTarget {
  name: string;
  config: SSHConfig;
}

const PING_TIMEOUT_MS = 5000;

async function probe(target: InfraTarget): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await sshExec(target.config, 'echo ok', { maxTimeoutMs: PING_TIMEOUT_MS });
    if (result.code === 0) return { ok: true };
    return { ok: false, error: `exit ${result.code}: ${(result.stderr || result.stdout || '').trim() || '(no output)'}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function resolvePreviousIssues(targetName: string): Promise<void> {
  // Auto-resolve unresolved infra-check events for this target so the Events
  // tab and /api/health stop showing a problem that has cleared.
  await db.update(scanEvents)
    .set({ resolved: true, resolvedAt: new Date(), resolvedBy: 'infra-check-auto' })
    .where(and(
      eq(scanEvents.source, 'infra-check'),
      eq(scanEvents.resolved, false),
      like(scanEvents.message, `Cannot reach ${targetName}:%`),
    ));
}

async function logFailure(targetName: string, error: string): Promise<void> {
  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    console.error(`[infra-check] ${targetName} unreachable: ${error} (no workspaces yet, not persisting)`);
    return;
  }
  const message = `Cannot reach ${targetName}: ${error}`;
  for (const ws of workspaces) {
    await db.insert(scanEvents).values({
      workspaceId: ws.id,
      level: 'error',
      source: 'infra-check',
      message,
      details: { target: targetName, error },
    });
  }
}

export async function runInfraCheck(targets?: InfraTarget[]): Promise<void> {
  const list = targets ?? [
    { name: 'security-tools', config: getSecurityToolsConfig() },
    { name: 'claude-runner',  config: getClaudeRunnerConfig()  },
  ];

  for (const target of list) {
    const result = await probe(target);
    if (result.ok) {
      console.log(`[infra-check] ${target.name}: ok`);
      await resolvePreviousIssues(target.name);
    } else {
      console.error(`[infra-check] ${target.name}: ${result.error}`);
      await logFailure(target.name, result.error);
    }
  }
}

export interface InfraStatus {
  degraded: boolean;
  issues: { message: string; source: string }[];
}

export async function hasOpenInfraIssues(): Promise<InfraStatus> {
  const rows = await db
    .select({ message: scanEvents.message, source: scanEvents.source })
    .from(scanEvents)
    .where(and(eq(scanEvents.source, 'infra-check'), eq(scanEvents.resolved, false), eq(scanEvents.level, 'error')));

  // We log one event per workspace so each user sees the issue in their own
  // Events tab — but for the global health summary, collapse duplicates.
  const seen = new Set<string>();
  const issues: { message: string; source: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.message)) continue;
    seen.add(r.message);
    issues.push(r);
  }
  return { degraded: issues.length > 0, issues };
}
