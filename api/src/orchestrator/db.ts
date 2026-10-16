import { eq, and, asc, desc, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scans, scanSteps, type Scan } from '../db/schema.ts';

export async function createScan(data: {
  repoUrl?: string;
  repoName: string;
  branch?: string;
  commitHash?: string;
  localPath?: string;
  workspaceId?: number;
  repositoryId?: number;
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
    scanType: data.scanType ?? 'full',
  }).returning();
  return row;
}

export async function getScan(id: string): Promise<Scan | null> {
  const rows = await db.select().from(scans).where(eq(scans.id, id));
  return rows[0] ?? null;
}

export type ListedScan = Scan & { stepStatuses: { stepName: string; status: string }[] };

export async function listScans(
  limit = 20,
  offset = 0,
  workspaceId?: number,
  status?: string,
  repositoryId?: number,
): Promise<{ count: number; results: ListedScan[] }> {
  const conditions: SQL[] = [];
  if (workspaceId) conditions.push(eq(scans.workspaceId, workspaceId));
  if (status) conditions.push(eq(scans.status, status));
  if (repositoryId) conditions.push(eq(scans.repositoryId, repositoryId));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
    .from(scans).where(whereClause);

  const order = status === 'queued' ? asc(scans.createdAt) : desc(scans.createdAt);
  const results = await db.select().from(scans)
    .where(whereClause)
    .orderBy(order)
    .limit(limit)
    .offset(offset);

  // Step name + status only — the list draws a progress strip per row, and the
  // step input/output columns can be large.
  const stepRows = results.length
    ? await db.select({ scanId: scanSteps.scanId, stepName: scanSteps.stepName, status: scanSteps.status })
      .from(scanSteps)
      .where(inArray(scanSteps.scanId, results.map((r) => r.id)))
      .orderBy(asc(scanSteps.stepOrder))
    : [];

  return {
    count: countResult.count,
    results: results.map((scan) => ({
      ...scan,
      stepStatuses: stepRows
        .filter((r) => r.scanId === scan.id)
        .map(({ stepName, status }) => ({ stepName, status })),
    })),
  };
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
