import { sshExec, getClaudeRunnerConfig, sshWriteFile } from '../ssh.ts';
import { classifyPath, categoryToBucket, type ScanCategory, type LinguistCategory } from './linguist-classifier.ts';

/**
 * Raw metadata from mirror-builder's _metadata.jsonl.
 */
export interface FileMetadata {
  path: string;
  size_bytes: number;
  line_count: number;
  mtime: number;
  ext: string;
  sha256_head_1kb: string;
  is_binary: boolean;
  avg_line_length: number;
}

/**
 * Metadata enriched with classification from hard rules + linguist.
 */
export interface ClassifiedFile extends FileMetadata {
  bucket: ScanCategory;
  linguist_category: LinguistCategory;
  /** Reason the file was placed in its bucket (for debugging / transparency). */
  reason: string;
}

// ── Hard rules: deterministic TRASH filter before linguist ────────────────────
// These run on metadata alone (no content reads) and are designed to catch
// minified/data-blob/oversized files that linguist may miss.

const HARD_SIZE_LIMIT = 2 * 1024 * 1024; // 2MB
const MINIFIED_AVG_LINE_LEN = 500;       // avg chars/line > 500 → minified
const GIANT_SINGLE_LINE_SIZE = 10 * 1024; // lines ≤ 1 AND size > 10KB → single giant line

/**
 * Apply hard rules. Returns a reason string if the file is TRASH by hard rules,
 * or null if no hard rule matched.
 */
function hardRuleTrashReason(f: FileMetadata): string | null {
  if (f.is_binary) return 'binary';
  if (f.size_bytes > HARD_SIZE_LIMIT) return `size>${HARD_SIZE_LIMIT}`;
  if (f.avg_line_length > MINIFIED_AVG_LINE_LEN) return `avg_line_length>${MINIFIED_AVG_LINE_LEN} (minified)`;
  if (f.line_count <= 1 && f.size_bytes > GIANT_SINGLE_LINE_SIZE) return 'single-giant-line';
  return null;
}

/**
 * Classify a single file using (1) hard rules on metadata, (2) linguist patterns.
 * Never reads file content.
 */
export function classifyFile(f: FileMetadata): ClassifiedFile {
  const hardReason = hardRuleTrashReason(f);
  if (hardReason) {
    return { ...f, bucket: 'TRASH', linguist_category: null, reason: `hard-rule: ${hardReason}` };
  }

  const linguistCat = classifyPath(f.path);
  const bucket = categoryToBucket(linguistCat);
  const reason = linguistCat
    ? `linguist: ${linguistCat}`
    : `linguist: no-match (unknown extension)`;
  return { ...f, bucket, linguist_category: linguistCat, reason };
}

/**
 * Load raw metadata.jsonl from the claude-runner over SSH and parse each line.
 *
 * Throws on non-zero exit (missing/unreadable file) — a failed `cat` must not
 * be silently treated as "no files", or the scan completes with zero modules.
 * A genuinely empty file (exit 0, empty stdout) still returns [].
 */
export async function loadMetadataJsonl(metadataPath: string, cancelSignal?: AbortSignal): Promise<FileMetadata[]> {
  const result = await sshExec(getClaudeRunnerConfig(), `cat ${JSON.stringify(metadataPath)}`, { signal: cancelSignal });
  if (result.code !== 0) {
    const stderrTail = result.stderr.length > 2048 ? '...' + result.stderr.slice(-2048) : result.stderr;
    throw new Error(
      `Failed to read mirror metadata at ${metadataPath} (exit ${result.code}): ${stderrTail.trim() || '(no stderr)'}`,
    );
  }
  const lines = result.stdout.split('\n');
  const files: FileMetadata[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      files.push(JSON.parse(trimmed) as FileMetadata);
    } catch {
      // Skip malformed
    }
  }
  return files;
}

/**
 * Run the pre-classifier over all files and write a classified metadata file
 * next to the original. Returns the full classified list and bucket counts.
 */
export async function preClassifyAll(metadataPath: string, classifiedOutPath: string, cancelSignal?: AbortSignal): Promise<{
  files: ClassifiedFile[];
  counts: Record<ScanCategory, number>;
}> {
  const raw = await loadMetadataJsonl(metadataPath, cancelSignal);
  const files = raw.map(classifyFile);

  const counts: Record<ScanCategory, number> = { TRASH: 0, DOCS: 0, INTERESTING: 0, UNCLEAR: 0 };
  for (const f of files) counts[f.bucket]++;

  // Write one JSON per line so large repos don't pressure memory on re-read
  const content = files.map(f => JSON.stringify(f)).join('\n') + '\n';
  await sshWriteFile(getClaudeRunnerConfig(), classifiedOutPath, content, cancelSignal);

  return { files, counts };
}
