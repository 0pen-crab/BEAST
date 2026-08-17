import { execFile } from 'child_process';
import * as fs from 'fs';
import type { PipelineContext, StepInput, CloneOutput } from '../pipeline-types.ts';
import { SCANNER_UID, SCANNER_GID } from '../pipeline-types.ts';
import { getRepoCloneCredentials } from '../entities.ts';
import { buildAuthCloneUrl } from '../git-providers.ts';
import { withRetry } from '../../lib/retry.ts';

const GIT_TIMEOUT_MS = 1_200_000; // 20 min per git command (corporate proxy throttles egress ~700 KiB/s; large clones need headroom)

function ensureScanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  chownToScanner(dir);
}

/**
 * The worker runs as root, but AI agents on claude-runner run as `scanner`
 * over the shared /workspace volume — every dir an agent writes into must be
 * scanner-owned. A failed chown must fail the scan HERE: swallowed, it
 * resurfaces minutes later as "Analyzer did not write scan context" with no
 * hint of the real cause (scan 7d895f66).
 */
function chownToScanner(dir: string): void {
  try {
    fs.chownSync(dir, SCANNER_UID, SCANNER_GID);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to chown ${dir} to scanner (${SCANNER_UID}:${SCANNER_GID}): ${msg} — remote agents would not be able to write scan results`);
  }
}

export async function runCloneStep({ ctx }: StepInput): Promise<Record<string, unknown>> {
  // Resolve authenticated clone URL if credentials exist
  if (ctx.cloneUrl) {
    const creds = await getRepoCloneCredentials(ctx.repoName, ctx.repoUrl, ctx.repositoryId || undefined);
    if (creds) {
      ctx.cloneUrl = buildAuthCloneUrl(creds.provider, ctx.cloneUrl, creds.token, creds.email);
    }
  }

  await cloneRepo(ctx);

  // The analyzer runs on claude-runner as the `scanner` user and writes
  // scan-context.md / repo-profile.md into the repo base dir
  // (/workspace/src-<sourceId>/<repo>). In local-path mode cloneRepo creates
  // no directories at all, so the base dir must be created here before
  // ownership can be handed to scanner.
  fs.mkdirSync(ctx.repoBaseDir, { recursive: true });
  chownToScanner(ctx.repoBaseDir);

  ensureScanDir(ctx.toolsDir);
  ensureScanDir(ctx.agentDir);
  chownToScanner(ctx.workDir);

  return {
    repoPath: ctx.repoPath,
    cloneUrl: ctx.cloneUrl,
    branch: ctx.branch,
    commitHash: ctx.commitHash,
  } satisfies CloneOutput;
}

export async function cloneRepo(ctx: PipelineContext): Promise<void> {
  const { cloneUrl, repoPath, branch, commitHash, cancelSignal } = ctx;

  if (!cloneUrl) {
    // Local path mode — validate the path exists
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Local path "${repoPath}" does not exist`);
    }
    return;
  }

  if (repoExists(repoPath)) {
    // Existing repo — restore auth on the remote for fetch, then checkout
    await execGit(['remote', 'set-url', 'origin', cloneUrl], repoPath, cancelSignal);
    await execGit(['fetch', '--all', '--prune'], repoPath, cancelSignal);

    if (commitHash) {
      await execGit(['checkout', commitHash], repoPath, cancelSignal);
    } else if (branch) {
      await execGit(['checkout', branch], repoPath, cancelSignal);
      await execGit(['pull', 'origin', branch], repoPath, cancelSignal);
    } else {
      await execGit(['pull'], repoPath, cancelSignal);
    }
  } else {
    // Fresh clone
    fs.mkdirSync(ctx.workDir, { recursive: true });
    await execGitWithDnsRetry(['clone', cloneUrl, repoPath], undefined, cancelSignal);

    if (commitHash) {
      await execGit(['checkout', commitHash], repoPath, cancelSignal);
    } else if (branch) {
      await execGit(['checkout', branch], repoPath, cancelSignal);
    }
  }

  // Scrub the access token from .git/config. buildAuthCloneUrl embeds it in the
  // remote URL, which git persists in plaintext — the scanner then flags it as a
  // leaked secret (a false positive about our own clone mechanism). Reset the
  // remote to the credential-free URL once all fetching is done.
  const cleanUrl = stripCredentials(cloneUrl);
  if (cleanUrl !== cloneUrl) {
    await execGit(['remote', 'set-url', 'origin', cleanUrl], repoPath, cancelSignal);
  }
}

// Removes userinfo (user:token@) from an https clone URL so it isn't persisted
// in .git/config. SSH/other URLs are returned unchanged.
export function stripCredentials(url: string): string {
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url.replace(/^([a-z]+:\/\/)[^/@]*@/i, '$1');
  }
}

function isTransientDnsError(message: string): boolean {
  return /Could not resolve host|Temporary failure in name resolution|getaddrinfo (EAI_AGAIN|ENOTFOUND|EBUSY)|DNS server returned general failure/i.test(message);
}

// Retries clone on transient DNS errors. Docker's embedded resolver
// (127.0.0.11) occasionally returns SERVFAIL — surfacing those to the user as
// a hard failure means they re-run the whole scan for a problem that resolves
// itself in seconds. Backoff sleeps are async (withRetry) so the worker event
// loop keeps servicing cancel polling and timers while waiting.
async function execGitWithDnsRetry(args: string[], cwd?: string, signal?: AbortSignal, attempts = 3): Promise<void> {
  let attempt = 0;
  await withRetry(
    () => {
      attempt += 1;
      return execGit(args, cwd, signal);
    },
    {
      attempts,
      backoffMs: 2000, // 2s, then 4s (exponential)
      shouldRetry: (err) => {
        if (signal?.aborted) return false;
        const message = err instanceof Error ? err.message : String(err);
        if (!isTransientDnsError(message)) return false;
        console.warn(`[clone] DNS transient (attempt ${attempt}/${attempts}); retrying with backoff: ${message.slice(0, 200)}`);
        return true;
      },
    },
  );
}

function repoExists(repoPath: string): boolean {
  return fs.existsSync(`${repoPath}/.git`);
}

const CANCEL_MESSAGE = 'Git command aborted by cancellation';

// Async git execution — the worker event loop stays free during clones, and
// the AbortSignal kills the in-flight git process the moment a scan is
// cancelled. Args are passed as an array (no shell), so URLs need no quoting.
function execGit(args: string[], cwd?: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(CANCEL_MESSAGE));
      return;
    }
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, signal }, (err, stdout, stderr) => {
      if (!err) {
        resolve();
        return;
      }
      if (signal?.aborted || err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        reject(new Error(CANCEL_MESSAGE));
        return;
      }
      const detail = String(stderr ?? '') || String(stdout ?? '');
      reject(new Error(`Clone failed (exit ${err.code}): ${detail}`));
    });
  });
}
