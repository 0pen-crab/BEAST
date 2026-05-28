import { execSync } from 'child_process';
import * as fs from 'fs';
import type { PipelineContext, StepInput, CloneOutput } from '../pipeline-types.ts';
import { SCANNER_UID, SCANNER_GID } from '../pipeline-types.ts';
import { getRepoCloneCredentials } from '../entities.ts';
import { buildAuthCloneUrl } from '../git-providers.ts';

function ensureScanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  try { fs.chownSync(dir, SCANNER_UID, SCANNER_GID); } catch { /* non-fatal in dev */ }
}

export async function runCloneStep({ ctx }: StepInput): Promise<Record<string, unknown>> {
  // Resolve authenticated clone URL if credentials exist
  if (ctx.cloneUrl) {
    const creds = await getRepoCloneCredentials(ctx.repoName, ctx.repoUrl);
    if (creds) {
      ctx.cloneUrl = buildAuthCloneUrl(creds.provider, ctx.cloneUrl, creds.token, creds.email);
    }
  }

  await cloneRepo(ctx);

  ensureScanDir(ctx.toolsDir);
  ensureScanDir(ctx.agentDir);

  return {
    repoPath: ctx.repoPath,
    cloneUrl: ctx.cloneUrl,
    branch: ctx.branch,
    commitHash: ctx.commitHash,
  } satisfies CloneOutput;
}

export async function cloneRepo(ctx: PipelineContext): Promise<void> {
  const { cloneUrl, repoPath, branch, commitHash } = ctx;

  if (!cloneUrl) {
    // Local path mode — validate the path exists
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Local path "${repoPath}" does not exist`);
    }
    return;
  }

  if (repoExists(repoPath)) {
    // Existing repo — fetch + checkout
    execGit(`git fetch --all --prune`, repoPath);

    if (commitHash) {
      execGit(`git checkout ${commitHash}`, repoPath);
    } else if (branch) {
      execGit(`git checkout ${branch}`, repoPath);
      execGit(`git pull origin ${branch}`, repoPath);
    } else {
      execGit(`git pull`, repoPath);
    }
  } else {
    // Fresh clone
    fs.mkdirSync(ctx.workDir, { recursive: true });
    execGitWithDnsRetry(`git clone "${cloneUrl}" "${repoPath}"`);

    if (commitHash) {
      execGit(`git checkout ${commitHash}`, repoPath);
    } else if (branch) {
      execGit(`git checkout ${branch}`, repoPath);
    }
  }
}

function isTransientDnsError(message: string): boolean {
  return /Could not resolve host|Temporary failure in name resolution|getaddrinfo (EAI_AGAIN|ENOTFOUND|EBUSY)|DNS server returned general failure/i.test(message);
}

// Retries clone on transient DNS errors. Docker's embedded resolver
// (127.0.0.11) occasionally returns SERVFAIL — surfacing those to the user as
// a hard failure means they re-run the whole scan for a problem that resolves
// itself in seconds.
function execGitWithDnsRetry(command: string, cwd?: string, attempts = 3): void {
  const delaysMs = [2000, 5000];
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      execGit(command, cwd);
      return;
    } catch (err: any) {
      lastErr = err;
      if (!isTransientDnsError(err?.message ?? '')) throw err;
      const delay = delaysMs[i];
      if (delay === undefined) break;
      console.warn(`[clone] DNS transient (attempt ${i + 1}/${attempts}); retrying in ${delay}ms: ${err.message.slice(0, 200)}`);
      const end = Date.now() + delay;
      while (Date.now() < end) { /* busy wait — execSync is sync, can't await */ }
    }
  }
  throw lastErr;
}

function repoExists(repoPath: string): boolean {
  return fs.existsSync(`${repoPath}/.git`);
}

function execGit(command: string, cwd?: string): void {
  try {
    execSync(command, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000, // 5 min
    });
  } catch (err: any) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    throw new Error(`Clone failed (exit ${err.status}): ${stderr || stdout}`);
  }
}
