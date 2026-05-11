import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scanModules, type ScanModule } from '../db/schema.ts';

export type ScanModuleStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Idempotently create a scan_modules row for (scanId, moduleIndex).
 * Returns existing row if one already exists for the same (scanId, moduleIndex).
 */
export async function ensureScanModule(input: {
  scanId: string;
  moduleIndex: number;
  moduleName: string;
  fileCount: number;
  outputPath: string;
}): Promise<ScanModule> {
  const [existing] = await db.select().from(scanModules)
    .where(and(eq(scanModules.scanId, input.scanId), eq(scanModules.moduleIndex, input.moduleIndex)));
  if (existing) return existing;

  const [row] = await db.insert(scanModules).values({
    scanId: input.scanId,
    moduleIndex: input.moduleIndex,
    moduleName: input.moduleName,
    fileCount: input.fileCount,
    outputPath: input.outputPath,
    status: 'pending',
  }).returning();
  return row;
}

export async function listScanModules(scanId: string): Promise<ScanModule[]> {
  return db.select().from(scanModules)
    .where(eq(scanModules.scanId, scanId))
    .orderBy(asc(scanModules.moduleIndex));
}

export async function markScanModuleRunning(id: number): Promise<void> {
  await db.update(scanModules)
    .set({ status: 'running', startedAt: new Date(), error: null })
    .where(eq(scanModules.id, id));
}

export async function markScanModuleCompleted(id: number): Promise<void> {
  await db.update(scanModules)
    .set({ status: 'completed', completedAt: new Date(), error: null })
    .where(eq(scanModules.id, id));
}

/** Mark a module back to pending (e.g. on rate-limit) so resume picks it up. */
export async function markScanModulePending(id: number, errorMessage?: string): Promise<void> {
  await db.update(scanModules)
    .set({ status: 'pending', error: errorMessage ?? null })
    .where(eq(scanModules.id, id));
}

export async function markScanModuleFailed(id: number, errorMessage: string): Promise<void> {
  await db.update(scanModules)
    .set({ status: 'failed', completedAt: new Date(), error: errorMessage })
    .where(eq(scanModules.id, id));
}
