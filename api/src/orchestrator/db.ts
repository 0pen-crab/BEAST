import { eq, and, asc, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scans, type Scan } from '../db/schema.ts';

export type { Scan as ScanRow } from '../db/schema.ts';

export async function createScan(data: {
  repoUrl?: string;
  repoName: string;
  branch?: string;
  commitHash?: string;
  localPath?: string;
  workspaceId?: number;
  repositoryId?: number;
  pullRequestId?: number;
  scanType?: string;
}): Promise<Scan> {
  const [row] = await db.insert(scans).values({
    repoUrl: data.repoUrl ?? null,
    repoName: data.repoName,
    branch: data.branch ?? null,
    commitHash: data.commitHash ?? null,
    localPath: data.localPath ?? null,
    workspaceId: data.workspaceId ?? null,
    repositoryId: data.repositoryId ?? null,
    pullRequestId: data.pullRequestId ?? null,
    scanType: data.scanType ?? 'full',
  }).returning();
  return row;
}

export async function getScan(id: string): Promise<Scan | null> {
  const rows = await db.select().from(scans).where(eq(scans.id, id));
  return rows[0] ?? null;
}

export async function listScans(
  limit = 20,
  offset = 0,
  workspaceId?: number,
  status?: string,
): Promise<{ count: number; results: Scan[] }> {
  const conditions: SQL[] = [];
  if (workspaceId) conditions.push(eq(scans.workspaceId, workspaceId));
  if (status) conditions.push(eq(scans.status, status));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
    .from(scans).where(whereClause);

  const order = status === 'queued' ? asc(scans.createdAt) : desc(scans.createdAt);
  const results = await db.select().from(scans)
    .where(whereClause)
    .orderBy(order)
    .limit(limit)
    .offset(offset);

  return { count: countResult.count, results };
}

export async function updateScan(
  id: string,
  updates: Partial<Pick<Scan, 'status' | 'error' | 'metadata' | 'startedAt' | 'completedAt' | 'durationMs'>>,
): Promise<Scan> {
  const setObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setObj[key] = value;
    }
  }

  const [row] = await db.update(scans)
    .set(setObj)
    .where(eq(scans.id, id))
    .returning();
  return row;
}
