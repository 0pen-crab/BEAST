// Deciding what an uploaded archive actually contains.
//
// Two shapes arrive in practice and they need opposite handling:
//
//   a) a container of projects — every top-level entry is a project directory;
//   b) a single project — the code sits at the archive root (run.py, setup.py,
//      requirements.txt next to a package directory).
//
// The rule is deliberately blunt: A DIRECTORY THAT CONTAINS FILES IS A
// REPOSITORY. A directory that contains nothing but other directories is a
// container, so the same question is asked of each child.
//
// The only hard part is what counts as "a file". A whitelist of project
// markers (package.json, requirements.txt, go.mod, ...) is the obvious idea
// and the wrong one: a plain C++/CMake tree, a PHP dump or a folder of shell
// scripts has no marker, so the archive would be read as a container, each of
// its subdirectories imported as a separate repo, and every loose file at the
// root silently dropped from the scan. That failure is invisible — the UI
// happily reports "3 repositories found".
//
// So the list runs the other way: everything is a file unless it is known
// noise (.DS_Store, Thumbs.db, editor swapfiles, AppleDouble stubs). An
// unrecognised name is therefore treated as real code, which collapses the
// archive to ONE repository and scans all of it. The worst case is a
// redundant repo entry the user can see and delete; nothing goes unscanned.

import { readdirSync } from 'fs';
import { join, relative, sep } from 'path';

/** Files that say nothing about whether a directory is a project. */
const NOISE_FILES = new Set([
  '.DS_Store', '.localized', '.AppleDouble', '.apdisk',
  'Thumbs.db', 'ehthumbs.db', 'desktop.ini',
  '.directory', '.netrwhist',
]);

/** AppleDouble stubs (._foo), editor backups (foo~) and vim swapfiles. */
const NOISE_PATTERNS = [/^\._/, /~$/, /\.sw[a-p]$/];

/** Directories that are tooling output or metadata — never a repository. */
const JUNK_DIRS = new Set([
  '.git', '.svn', '.hg',
  '__MACOSX', '$RECYCLE.BIN', '.Spotlight-V100', '.Trashes', '.fseventsd', '.TemporaryItems',
  '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox',
  'node_modules', '.idea', '.vscode', '.gradle', 'venv', '.venv',
]);

/**
 * How deep to look for projects inside grouping directories
 * (archive/teamA/api). Past this depth a directory is taken as a repository
 * as-is, so a deeply nested tree is imported whole rather than lost.
 */
const MAX_DEPTH = 4;

export interface DiscoveredRepo {
  name: string;
  path: string;
}

export interface DiscoveryResult {
  layout: 'single' | 'multi';
  repos: DiscoveredRepo[];
  /** Paths (relative to root) ignored as noise — logged so the skip is visible. */
  skipped: string[];
}

function isNoiseFile(name: string): boolean {
  return NOISE_FILES.has(name) || NOISE_PATTERNS.some((re) => re.test(name));
}

const stripBranch = (name: string) => name.replace(/-(main|master|develop|dev)$/, '');

/**
 * Classify an extracted archive into the repositories it holds.
 *
 * @param rootDir     Extraction directory.
 * @param archiveName Archive filename without extension — used as the repo
 *                    name when the whole archive turns out to be one project.
 * @throws when the tree holds nothing scannable; an empty import must never
 *         look like a successful one.
 */
export function discoverRepos(rootDir: string, archiveName: string): DiscoveryResult {
  const found: string[] = [];
  const skipped: string[] = [];

  walk(rootDir, 0, rootDir, found, skipped);

  if (found.length === 0) {
    throw new Error(
      `Archive "${archiveName}" has no scannable content: every entry is empty or ignored `
      + `noise${skipped.length ? ` (${skipped.join(', ')})` : ''}.`,
    );
  }

  return {
    layout: found.length === 1 ? 'single' : 'multi',
    repos: nameRepos(found, rootDir, archiveName),
    skipped,
  };
}

function walk(dir: string, depth: number, rootDir: string, found: string[], skipped: string[]): void {
  const dirs: string[] = [];
  let hasFiles = false;
  let hasGit = false;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') hasGit = true;

    if (entry.isDirectory()) {
      if (JUNK_DIRS.has(entry.name)) {
        skipped.push(relative(rootDir, join(dir, entry.name)));
        continue;
      }
      dirs.push(entry.name);
    } else {
      if (isNoiseFile(entry.name)) {
        skipped.push(relative(rootDir, join(dir, entry.name)));
        continue;
      }
      hasFiles = true;
    }
  }

  // A checkout with all its code in subdirectories still has .git at the top,
  // which settles the question before the file/directory rule is consulted.
  if (hasGit || hasFiles || depth >= MAX_DEPTH) {
    if (hasGit || hasFiles || dirs.length > 0) found.push(dir);
    return;
  }

  // Nothing but directories: this is a container, ask the same of each child.
  for (const child of dirs) {
    walk(join(dir, child), depth + 1, rootDir, found, skipped);
  }
}

/**
 * Name each repository after its directory, falling back to the full path for
 * duplicates. `repositories` is unique on (team, name, source), so two
 * directories called "api" would otherwise collapse into one row and the
 * second project would never be scanned.
 */
function nameRepos(paths: string[], rootDir: string, archiveName: string): DiscoveredRepo[] {
  const baseName = (p: string) =>
    stripBranch(p === rootDir ? archiveName : p.slice(p.lastIndexOf(sep) + 1));

  const counts = new Map<string, number>();
  for (const p of paths) counts.set(baseName(p), (counts.get(baseName(p)) ?? 0) + 1);

  return paths.map((path) => {
    const base = baseName(path);
    const name = counts.get(base)! > 1
      ? stripBranch(relative(rootDir, path).split(sep).join('-'))
      : base;
    return { name, path };
  });
}
