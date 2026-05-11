import { sshExec, getClaudeRunnerConfig } from '../ssh.ts';
import type { PipelineContext } from '../pipeline-types.ts';

export interface MirrorInfo {
  mirrorPath: string;
  metadataPath: string;
  repoPath: string;
  fileCount: number;
  durationMs: number;
}

/**
 * Build a mirror of the repository containing per-file preview + metadata.
 *
 * Implemented as a single Python script running on the claude-runner. The previous
 * bash implementation forked ~6 subprocesses per file (stat, wc, perl, head, sha256sum, sed),
 * which meant ~50K forks for an 8K-file repo — about 50 seconds of overhead. A Python
 * script does the whole walk in one process, yielding ~10× speedup.
 *
 * Output:
 *   - {agentDir}/mirror/_metadata.jsonl   (one JSON object per line per file)
 *   - {agentDir}/mirror/<rel-path>        (preview: head-15 + middle-15, or marker)
 *
 * Skips preview generation (writes a "[SKIPPED: ...]" marker) when the file is
 * clearly not hand-written code:
 *   - binary (null byte in first 8KB)
 *   - size > 2MB
 *   - avg_line_length > 500 (minified)
 *   - line_count ≤ 1 AND size > 10KB (single giant line)
 *
 * Excludes common non-source directories at the walk level so we don't even touch them.
 */
export async function buildMirror(ctx: PipelineContext): Promise<MirrorInfo> {
  const mirrorPath = `${ctx.agentDir}/mirror`;
  const metadataPath = `${mirrorPath}/_metadata.jsonl`;
  const start = Date.now();

  console.log(`[mirror] building mirror at ${mirrorPath}`);

  const script = buildPythonScript();
  // Pipe the Python source via stdin to avoid the complexity of writing it to disk first.
  const sshCommand = `python3 -u - ${JSON.stringify(ctx.repoPath)} ${JSON.stringify(mirrorPath)} <<'PYEOF'
${script}
PYEOF`;

  const result = await sshExec(getClaudeRunnerConfig(), sshCommand, {
    inactivityTimeoutMs: 10 * 60 * 1000,
    maxTimeoutMs: 30 * 60 * 1000,
  });

  const fileCount = parseInt(result.stdout.trim(), 10) || 0;
  const durationMs = Date.now() - start;

  console.log(`[mirror] built mirror: ${fileCount} files, ${(durationMs / 1000).toFixed(1)}s`);

  return { mirrorPath, metadataPath, repoPath: ctx.repoPath, fileCount, durationMs };
}

/**
 * The Python script source. Kept as a TS-level constant so it's visible in grep and
 * easy to iterate on; serialised into the SSH heredoc above at runtime.
 *
 * Why Python and not Node remotely? The claude-runner image ships Python 3 by default
 * (it's on any Debian base) and we don't want to install a Node runtime there just for
 * this. Python stdlib has everything we need (os.walk, hashlib, json).
 */
function buildPythonScript(): string {
  return `
import os
import sys
import json
import hashlib

EXCLUDED_DIRS = {
    'node_modules', 'vendor', 'bower_components', '.npm', '.yarn', '.pnpm',
    'dist', 'build', 'out', '_build', 'target', 'coverage', '.nyc_output',
    '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', '.tox',
}

SIZE_HARD_CAP = 2 * 1024 * 1024    # 2MB
MINIFIED_AVG = 500                  # avg line length chars
SINGLE_LINE_SIZE = 10 * 1024        # 10KB

repo = sys.argv[1]
mirror = sys.argv[2]

# Clean slate for mirror output
import shutil
shutil.rmtree(mirror, ignore_errors=True)
os.makedirs(mirror, exist_ok=True)

metadata_path = os.path.join(mirror, '_metadata.jsonl')
count = 0

with open(metadata_path, 'w', encoding='utf-8') as meta_f:
    for root, dirs, files in os.walk(repo, followlinks=False):
        # prune excluded dirs in-place so os.walk skips them
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, repo)
            mirror_file = os.path.join(mirror, rel)
            try:
                os.makedirs(os.path.dirname(mirror_file), exist_ok=True)
            except OSError:
                continue

            try:
                st = os.stat(full)
            except OSError:
                continue
            size = st.st_size
            mtime = int(st.st_mtime)

            # Read first 8KB for binary detection + hash seed
            try:
                with open(full, 'rb') as f:
                    head_bytes = f.read(8192)
            except OSError:
                continue
            is_binary = b'\\x00' in head_bytes

            # Count lines (skip for binaries — meaningless)
            if is_binary:
                lines = 0
            else:
                try:
                    with open(full, 'rb') as f:
                        lines = 0
                        while True:
                            chunk = f.read(65536)
                            if not chunk:
                                break
                            lines += chunk.count(b'\\n')
                except OSError:
                    lines = 0

            avg_line_length = size // lines if lines > 0 else size

            # SHA-256 of first 1KB (stable dedup fingerprint)
            sha_head = hashlib.sha256(head_bytes[:1024]).hexdigest()

            base = os.path.basename(rel)
            ext = ''
            if '.' in base:
                ext = base.rsplit('.', 1)[1]

            # Hard-skip preview generation for TRASH candidates
            skip_preview = (
                is_binary
                or size > SIZE_HARD_CAP
                or avg_line_length > MINIFIED_AVG
                or (lines <= 1 and size > SINGLE_LINE_SIZE)
            )

            if skip_preview:
                if is_binary:
                    preview = "[BINARY]\\n"
                else:
                    preview = (
                        f"[SKIPPED: size={size} lines={lines} "
                        f"avg={avg_line_length} binary={str(is_binary).lower()}]\\n"
                    )
            else:
                # head-15 + "--- MIDDLE (line N) ---" + 15 lines from middle
                try:
                    with open(full, 'r', encoding='utf-8', errors='replace') as f:
                        content_lines = f.readlines()
                    head = content_lines[:15]
                    mid = max(lines // 2, 1)
                    middle = content_lines[mid - 1 : mid - 1 + 15]
                    preview = ''.join(head) + f"--- MIDDLE (line {mid}) ---\\n" + ''.join(middle)
                except OSError:
                    preview = "[READ-ERROR]\\n"

            try:
                with open(mirror_file, 'w', encoding='utf-8', errors='replace') as f:
                    f.write(preview)
            except OSError:
                continue

            meta_f.write(json.dumps({
                'path': rel,
                'size_bytes': size,
                'line_count': lines,
                'mtime': mtime,
                'ext': ext,
                'sha256_head_1kb': sha_head,
                'is_binary': is_binary,
                'avg_line_length': avg_line_length,
            }) + '\\n')
            count += 1

print(count)
`.trim();
}
