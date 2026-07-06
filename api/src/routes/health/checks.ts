import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { workerHeartbeat } from '../../db/schema.ts';
import { hasOpenInfraIssues, infraTargetFromMessage } from '../../orchestrator/infra-check.ts';
import { HEARTBEAT_ROW_ID } from '../../orchestrator/heartbeat.ts';

export type SystemName = 'db' | 'worker' | 'claude-runner' | 'security-tools';

export interface SystemFailure {
  system: SystemName;
  message: string;
}

export interface HealthCheckResult {
  /** 'down' = the database (the platform's backbone) is unreachable;
   *  'degraded' = API + DB are up but some subsystem is broken. */
  status: 'ok' | 'degraded' | 'down';
  failures: SystemFailure[];
}

/** Worker writes a heartbeat every ~60s; 3 missed beats ⇒ consider it down. */
export const WORKER_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Check every system BEAST depends on:
 *   - db:             SELECT 1 against Postgres
 *   - worker:         worker_heartbeat row fresher than ~3 minutes
 *   - claude-runner / security-tools: latest persisted infra-check state
 *
 * Trade-off (deliberate): claude-runner/security-tools reachability is read
 * from the persisted infra-check events (written at worker boot and refreshed
 * by scan activity), NOT live-probed here. /api/health is polled every 10s by
 * every open dashboard tab — opening an SSH connection to two hosts on each
 * poll would hammer them and make health latency depend on SSH timeouts
 * (up to 5s each). The persisted state can therefore lag behind reality until
 * the next probe runs; that staleness is the price of a cheap health check.
 */
export async function checkAllSystems(): Promise<HealthCheckResult> {
  // 1. Database. Everything else (heartbeat, infra events) lives in the DB,
  // so when it is down nothing else is checkable — report just the DB.
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    return {
      status: 'down',
      failures: [{ system: 'db', message: `Database is unreachable: ${errMsg(err)}` }],
    };
  }

  const failures: SystemFailure[] = [];

  // 2. Worker liveness via heartbeat.
  try {
    const rows = await db
      .select({ beatAt: workerHeartbeat.beatAt })
      .from(workerHeartbeat)
      .where(eq(workerHeartbeat.id, HEARTBEAT_ROW_ID));
    const beatAt = rows[0]?.beatAt;
    if (!beatAt) {
      failures.push({
        system: 'worker',
        message: 'Worker has never reported a heartbeat — the worker container is not running',
      });
    } else if (Date.now() - beatAt.getTime() > WORKER_HEARTBEAT_STALE_MS) {
      failures.push({
        system: 'worker',
        message: `Worker heartbeat is stale (last seen ${beatAt.toISOString()}) — the worker container appears to be down`,
      });
    }
  } catch (err) {
    // DB is up (checked above) but the heartbeat table can't be read — most
    // likely migrations didn't run. Worker liveness is genuinely unknown.
    failures.push({ system: 'worker', message: `Worker heartbeat could not be read: ${errMsg(err)}` });
  }

  // 3. claude-runner / security-tools from persisted infra-check state.
  try {
    const infra = await hasOpenInfraIssues();
    for (const issue of infra.issues) {
      const system = infraTargetFromMessage(issue.message);
      if (system) failures.push({ system, message: issue.message });
    }
  } catch (err) {
    // DB is proven up, so this is a transient query hiccup — don't fabricate
    // an infra outage from it (mirrors the previous /health behaviour).
    console.error('[health] infra status query failed:', err);
  }

  return { status: failures.length > 0 ? 'degraded' : 'ok', failures };
}
