import type { ClassifiedFile } from './pre-classifier.ts';

export interface PartitionModule {
  name: string;
  /** Files to scan for vulnerabilities. */
  interesting: string[];
  /** Adjacent documentation files the Sniper can consult for context. */
  docs: string[];
}

export interface PartitionResult {
  modules: PartitionModule[];
  counts: { interesting: number; docs: number; modules: number };
}

/**
 * Deterministic algorithmic partitioner.
 *
 * Groups INTERESTING files by source directory into modules. Each module
 * target size is `targetFilesPerModule` (default 1500). A directory split
 * only happens when its file count strictly exceeds `maxFilesPerModule`
 * (default `target * 1.5`). This means a 150-file directory at target=100
 * stays as one module — splitting only kicks in for genuine oversize.
 *
 * DOCS files are attached to the closest ancestor module by path.
 */
export function partition(
  files: ClassifiedFile[],
  opts: { targetFilesPerModule?: number; maxFilesPerModule?: number } = {},
): PartitionResult {
  const target = opts.targetFilesPerModule ?? 1500;
  const max = opts.maxFilesPerModule ?? Math.ceil(target * 1.5);

  const interestingFiles = files.filter(f => f.bucket === 'INTERESTING');
  const docsFiles = files.filter(f => f.bucket === 'DOCS');

  // Always partition by directory. Previously a small-repo shortcut emitted a
  // single module when total INTERESTING ≤ 2000, which collapsed mid-size repos
  // (300-2000 files) into one giant Sniper invocation — when Claude failed
  // mid-stream, the whole scan got 0 BEAST findings instead of 4/5 modules
  // worth. Always splitting trades a small per-module cache-create cost for
  // resilience and finer parallelism.

  // Group INTERESTING by directory
  const byDir = new Map<string, string[]>();
  for (const f of interestingFiles) {
    const dir = dirOf(f.path);
    const arr = byDir.get(dir) ?? [];
    arr.push(f.path);
    byDir.set(dir, arr);
  }

  // Walk directories — coalesce small ones, split large ones
  const modules: PartitionModule[] = [];

  // Sort dirs for stable output (deterministic)
  const sortedDirs = [...byDir.keys()].sort();

  // Carry-over bucket for small directories (< target/2 files) coalesced with siblings
  let carry: { name: string; files: string[] } | null = null;
  const FLUSH_CARRY = () => {
    if (carry && carry.files.length > 0) {
      modules.push({ name: moduleNameFromPath(carry.name), interesting: carry.files, docs: [] });
      carry = null;
    }
  };

  for (const dir of sortedDirs) {
    const dirFiles = byDir.get(dir)!;
    if (dirFiles.length > max) {
      // Strictly over `max` — split into chunks of `target` files
      FLUSH_CARRY();
      const chunks = chunk(dirFiles, target);
      chunks.forEach((ch, i) => {
        modules.push({
          name: `${moduleNameFromPath(dir)}_part${i + 1}`,
          interesting: ch,
          docs: [],
        });
      });
    } else if (dirFiles.length < target / 2) {
      // Small — try to coalesce with carry
      if (!carry) {
        carry = { name: dir, files: [...dirFiles] };
      } else if (carry.files.length + dirFiles.length <= max) {
        carry.files.push(...dirFiles);
        // Keep carry.name = highest common ancestor for readability? Or first.
        // For now keep first dir's name as canonical.
      } else {
        FLUSH_CARRY();
        carry = { name: dir, files: [...dirFiles] };
      }
    } else {
      // Medium size — its own module
      FLUSH_CARRY();
      modules.push({ name: moduleNameFromPath(dir), interesting: dirFiles, docs: [] });
    }
  }
  FLUSH_CARRY();

  // Attach DOCS to modules by path proximity (longest common directory prefix)
  for (const doc of docsFiles) {
    const docDir = dirOf(doc.path);
    const target = findBestModuleForDoc(docDir, modules);
    if (target) target.docs.push(doc.path);
  }

  return {
    modules,
    counts: {
      interesting: interestingFiles.length,
      docs: docsFiles.length,
      modules: modules.length,
    },
  };
}

/** Directory of a file path ("" for root-level files). */
function dirOf(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}

/** Derive a filesystem-safe module name from a directory path. */
function moduleNameFromPath(p: string): string {
  if (!p) return 'root';
  return p.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().slice(0, 80);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Attach a doc to whichever module has the longest shared directory prefix.
 * Returns the target module (mutated by caller) or null if none matches.
 */
function findBestModuleForDoc(docDir: string, modules: PartitionModule[]): PartitionModule | null {
  let best: PartitionModule | null = null;
  let bestScore = -1;
  for (const m of modules) {
    // Module "ancestor directory" = common prefix of its interesting files
    if (m.interesting.length === 0) continue;
    const moduleDir = commonDir(m.interesting);
    const score = sharedPrefixLength(docDir, moduleDir);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  // Only attach if there's some shared prefix (>0)
  return bestScore > 0 ? best : null;
}

function commonDir(paths: string[]): string {
  if (paths.length === 0) return '';
  let prefix = dirOf(paths[0]);
  for (let i = 1; i < paths.length; i++) {
    const d = dirOf(paths[i]);
    prefix = longestCommonDirPrefix(prefix, d);
    if (!prefix) break;
  }
  return prefix;
}

function longestCommonDirPrefix(a: string, b: string): string {
  const aParts = a.split('/');
  const bParts = b.split('/');
  const out: string[] = [];
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    if (aParts[i] === bParts[i]) out.push(aParts[i]);
    else break;
  }
  return out.join('/');
}

function sharedPrefixLength(a: string, b: string): number {
  return longestCommonDirPrefix(a, b).length;
}
