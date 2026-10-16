// Lists a repository's branches, most recently committed to first.
//
// Read from the clone the scanner already keeps rather than from the provider:
// Bitbucket, GitHub and GitLab all page their branch lists, and none of them
// answer "which branch is alive" in one request. The clone does, offline, with
// no credentials and no rate limit.
//
// Ranking is by last commit date, and that is a deliberate correction. Commit
// count is the obvious-looking metric and it does not work: every feature
// branch carries the entire history it forked from, so on a real repository
// (one with 128 branches and 36k commits) the counts landed between 31900 and
// 35786 and put feature branches ABOVE `development`, which sat mid-list. It
// also cost 21 seconds per request — 128 history walks on a two-core box, and
// neither parallelism nor a bitmap index moved it. `--sort=-committerdate` is
// one pass inside git: 4 milliseconds, and it actually answers the question.
//
// A repository that has never been scanned has no clone and therefore no
// branches to offer. That is reported as an empty list so the UI can say why,
// rather than showing a blank dropdown.

import { sshExec, getSecurityToolsConfig } from './ssh.ts';
import { shellQuote } from '../lib/shell.ts';

export interface RepoBranch {
  name: string;
  /** Last commit on the branch, ISO 8601. */
  lastCommitAt: string;
}

export interface RepoRef {
  id: number;
  name: string;
  sourceId: number | null;
}

/**
 * Where the pipeline clones this repository.
 *
 * Mirrors the layout in pipeline.ts — repos from a source live under
 * `src-<sourceId>`, the rest under `repo-<repositoryId>`. Keep the two in step:
 * a mismatch yields an empty branch list for every repository, with nothing to
 * indicate why.
 */
export function cloneDirFor(repo: RepoRef): string {
  const sourceKey = repo.sourceId != null ? `src-${repo.sourceId}` : `repo-${repo.id}`;
  return `/workspace/${sourceKey}/${repo.name}/repo`;
}

/** Exit code the script uses for "this repository has no clone yet". */
const NO_CLONE = 2;

/**
 * A dropdown with 128 entries is not a picker, it is a scroll. Ten covers the
 * branches anyone actually switches between; the saved one is kept selectable
 * by the UI even when it falls outside this window.
 */
export const MAX_BRANCHES = 10;

export async function listBranches(repo: RepoRef): Promise<RepoBranch[]> {
  const dir = cloneDirFor(repo);

  const script = [
    `test -d ${shellQuote(`${dir}/.git`)} || exit ${NO_CLONE}`,
    `cd ${shellQuote(dir)}`,
    `git for-each-ref --sort=-committerdate --format='%(committerdate:unix)%09%(refname:strip=3)' refs/remotes/origin`,
  ].join('\n');

  const result = await sshExec(getSecurityToolsConfig(), script, {
    inactivityTimeoutMs: 30_000,
  });

  if (result.code === NO_CLONE) return [];
  if (result.code !== 0) {
    throw new Error(
      `Failed to list branches for ${repo.name}: ${(result.stderr || result.stdout).trim().slice(0, 300)}`,
    );
  }

  return result.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([ts, name]) => ({ name: name.trim(), unix: Number(ts.trim()) }))
    // HEAD is a symbolic ref, not a branch — offering it would let someone pin
    // the default to "whatever the default is", which is what we just fixed.
    .filter((b) => b.name !== '' && b.name !== 'HEAD' && Number.isFinite(b.unix) && b.unix > 0)
    // git already sorted, but sort again before slicing: trusting the input
    // order means a change in git's output silently keeps the WRONG ten rather
    // than failing. Sorting a handful of rows costs nothing.
    .sort((a, b) => b.unix - a.unix || a.name.localeCompare(b.name))
    .slice(0, MAX_BRANCHES)
    .map((b) => ({ name: b.name, lastCommitAt: new Date(b.unix * 1000).toISOString() }));
}
