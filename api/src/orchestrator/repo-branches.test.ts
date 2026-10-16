import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSshExec, mockGetSecurityToolsConfig } = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
  mockGetSecurityToolsConfig: vi.fn().mockReturnValue({
    host: 'security-tools',
    port: 22,
    username: 'scanner',
    privateKey: Buffer.from('fake-key'),
  }),
}));

vi.mock('./ssh.ts', () => ({
  sshExec: mockSshExec,
  getSecurityToolsConfig: mockGetSecurityToolsConfig,
}));

import { listBranches, cloneDirFor } from './repo-branches.ts';

/** One line of the script's output: "<unix committer date>\t<branch>". */
function gitOutput(rows: Array<[number, string]>): string {
  return rows.map(([ts, b]) => `${ts}\t${b}`).join('\n') + '\n';
}

const DAY = 86_400;
const NOW = 1_783_700_000;

beforeEach(() => {
  vi.clearAllMocks();
  mockSshExec.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
});

describe('cloneDirFor', () => {
  it('points at the same directory the pipeline clones into', () => {
    // Must stay in step with pipeline.ts — a mismatch here silently yields an
    // empty branch list for every repo.
    expect(cloneDirFor({ id: 7, name: 'crm', sourceId: 1 })).toBe('/workspace/src-1/crm/repo');
  });

  it('falls back to the repository id when the repo has no source', () => {
    expect(cloneDirFor({ id: 7, name: 'crm', sourceId: null })).toBe('/workspace/repo-7/crm/repo');
  });
});

describe('listBranches', () => {
  const repo = { id: 7, name: 'crm', sourceId: 1 };

  it('returns branches most recently committed to first', async () => {
    // Ranking by commit COUNT looked obvious and turned out to be useless: every
    // feature branch carries the whole history it forked from, so on a real repo
    // (one with 128 branches and 36k commits) the counts sat between 31900 and
    // 35786 and put feature branches above `development`. It also cost 21
    // seconds per request. Last commit date answers "what is alive here" in 4ms.
    mockSshExec.mockResolvedValue({
      code: 0,
      stdout: gitOutput([
        [NOW - 30 * DAY, 'main'],
        [NOW - 1 * DAY, 'develop'],
        [NOW - 7 * DAY, 'release/2.0'],
      ]),
      stderr: '',
    });

    const branches = await listBranches(repo);

    expect(branches.map((b) => b.name)).toEqual(['develop', 'release/2.0', 'main']);
  });

  it('carries the commit date through so the UI can show it', async () => {
    mockSshExec.mockResolvedValue({
      code: 0,
      stdout: gitOutput([[NOW - DAY, 'develop']]),
      stderr: '',
    });

    const [branch] = await listBranches(repo);

    expect(branch.lastCommitAt).toBe(new Date((NOW - DAY) * 1000).toISOString());
  });

  it('returns at most ten branches', async () => {
    // A dropdown with 128 entries is not a picker, it is a scroll. Ten covers
    // the branches anyone actually switches between.
    const many: Array<[number, string]> = Array.from({ length: 128 }, (_, i) => [
      NOW - i * DAY,
      `branch-${i}`,
    ]);
    mockSshExec.mockResolvedValue({ code: 0, stdout: gitOutput(many), stderr: '' });

    const branches = await listBranches(repo);

    expect(branches).toHaveLength(10);
    // The ten kept must be the ten freshest, not the first ten git listed.
    expect(branches[0].name).toBe('branch-0');
    expect(branches[9].name).toBe('branch-9');
  });

  it('strips the origin/ prefix and drops the origin/HEAD pointer', async () => {
    // origin/HEAD is a symbolic ref, not a branch; offering it as a choice
    // would let someone pin the default to "whatever the default was".
    mockSshExec.mockResolvedValue({
      code: 0,
      stdout: gitOutput([[NOW, 'main'], [NOW, 'HEAD']]),
      stderr: '',
    });

    const branches = await listBranches(repo);

    expect(branches.map((b) => b.name)).toEqual(['main']);
  });

  it('asks git to sort, and never counts commits', async () => {
    // rev-list --count is what made this endpoint take 21 seconds; the sort has
    // to happen inside for-each-ref, in one pass.
    await listBranches(repo);

    const [, command] = mockSshExec.mock.calls[0];
    expect(command).toContain('/workspace/src-1/crm/repo');
    expect(command).toContain('--sort=-committerdate');
    expect(command).not.toContain('rev-list');
  });

  it('returns an empty list when the repo has never been cloned', async () => {
    // Exit 2 is the script's "no clone here" signal. The caller turns this into
    // an honest "scan it once and the branches appear", not a silent blank.
    mockSshExec.mockResolvedValue({ code: 2, stdout: '', stderr: 'no clone' });

    await expect(listBranches(repo)).resolves.toEqual([]);
  });

  it('throws when git itself fails, rather than reporting no branches', async () => {
    // A broken clone must not look identical to a repo with zero branches.
    mockSshExec.mockResolvedValue({ code: 1, stdout: '', stderr: 'fatal: not a git repository' });

    await expect(listBranches(repo)).rejects.toThrow(/not a git repository/);
  });

  it('ignores malformed lines instead of emitting invalid dates', async () => {
    mockSshExec.mockResolvedValue({
      code: 0,
      stdout: `${NOW}\tmain\n\n   \ngarbage-without-a-tab\nnot-a-number\tbad\n`,
      stderr: '',
    });

    const branches = await listBranches(repo);

    expect(branches.map((b) => b.name)).toEqual(['main']);
  });
});
