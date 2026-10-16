import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveInsideRepo } from './repositories.ts';

// Scanned repositories are untrusted content: a repo can ship symlinks or
// sit next to a similarly-named folder. Only paths that really live inside
// the clone may be listed or read.
describe('resolveInsideRepo', () => {
  let base: string;
  let repo: string;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'beast-mcp-'));
    repo = path.join(base, 'repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'ok');
    fs.mkdirSync(path.join(base, 'repo-evil'));
    fs.writeFileSync(path.join(base, 'repo-evil', 'secret.txt'), 'secret');
    fs.writeFileSync(path.join(base, 'outside.txt'), 'secret');
    fs.symlinkSync(path.join(base, 'outside.txt'), path.join(repo, 'link-out'));
    fs.symlinkSync(path.join(base, 'repo-evil'), path.join(repo, 'dir-out'));
    fs.symlinkSync(path.join(repo, 'src', 'app.ts'), path.join(repo, 'link-in'));
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('resolves a regular file inside the repo', () => {
    expect(resolveInsideRepo(repo, 'src/app.ts')).toBe(path.join(fs.realpathSync(repo), 'src', 'app.ts'));
  });

  it('resolves the repo root itself', () => {
    expect(resolveInsideRepo(repo, '.')).toBe(fs.realpathSync(repo));
  });

  it('follows a symlink that stays inside the repo', () => {
    expect(resolveInsideRepo(repo, 'link-in')).toBe(path.join(fs.realpathSync(repo), 'src', 'app.ts'));
  });

  it('refuses a symlink to a file outside the repo', () => {
    expect(resolveInsideRepo(repo, 'link-out')).toBeNull();
  });

  it('refuses a symlinked directory outside the repo', () => {
    expect(resolveInsideRepo(repo, 'dir-out/secret.txt')).toBeNull();
  });

  it('refuses .. traversal, including into a sibling with the same prefix', () => {
    expect(resolveInsideRepo(repo, '../outside.txt')).toBeNull();
    expect(resolveInsideRepo(repo, '../repo-evil/secret.txt')).toBeNull();
  });

  it('refuses absolute paths', () => {
    expect(resolveInsideRepo(repo, path.join(base, 'outside.txt'))).toBeNull();
  });

  it('returns null for a path that does not exist', () => {
    expect(resolveInsideRepo(repo, 'missing.ts')).toBeNull();
  });
});
