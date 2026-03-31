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
    execGit(`git clone "${cloneUrl}" "${repoPath}"`);

    if (commitHash) {
      execGit(`git checkout ${commitHash}`, repoPath);
    } else if (branch) {
      execGit(`git checkout ${branch}`, repoPath);
    }
  }
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
