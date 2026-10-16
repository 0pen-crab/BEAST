import { describe, it, expect } from 'vitest';
import { partition } from './partitioner.ts';
import type { ClassifiedFile } from './pre-classifier.ts';

function f(path: string, bucket: ClassifiedFile['bucket']): ClassifiedFile {
  return {
    path, bucket,
    size_bytes: 1000, line_count: 50, mtime: 0, ext: '', sha256_head_1kb: '',
    is_binary: false, avg_line_length: 20,
    linguist_category: null, reason: 'test',
  };
}

describe('partition', () => {
  it('groups small directories into one module', () => {
    const files = [
      f('src/auth/login.ts', 'INTERESTING'),
      f('src/auth/session.ts', 'INTERESTING'),
      f('src/user/profile.ts', 'INTERESTING'),
    ];
    const result = partition(files, { targetFilesPerModule: 150 });
    expect(result.counts.interesting).toBe(3);
    expect(result.modules.length).toBeGreaterThan(0);
    // All files accounted for
    const allFiles = result.modules.flatMap(m => m.interesting);
    expect(allFiles).toHaveLength(3);
  });

  it('splits directory exceeding maxFilesPerModule', () => {
    const files = Array.from({ length: 500 }, (_, i) =>
      f(`big/module/file${i}.ts`, 'INTERESTING'),
    );
    const result = partition(files, { targetFilesPerModule: 150, maxFilesPerModule: 200 });
    // 500 / 150 = 4 chunks (150+150+150+50)
    expect(result.modules.length).toBeGreaterThanOrEqual(3);
    expect(result.modules.every(m => m.interesting.length <= 200)).toBe(true);
    // All files preserved
    const allFiles = result.modules.flatMap(m => m.interesting).sort();
    expect(allFiles).toHaveLength(500);
  });

  it('medium-size directory gets own module', () => {
    const files = Array.from({ length: 100 }, (_, i) =>
      f(`src/api/handler${i}.ts`, 'INTERESTING'),
    );
    const result = partition(files, { targetFilesPerModule: 150 });
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].interesting).toHaveLength(100);
  });

  it('TRASH files are excluded from modules', () => {
    const files = [
      f('src/auth/login.ts', 'INTERESTING'),
      f('src/auth/old.min.js', 'TRASH'),
    ];
    const result = partition(files);
    const all = result.modules.flatMap(m => m.interesting);
    expect(all).toContain('src/auth/login.ts');
    expect(all).not.toContain('src/auth/old.min.js');
  });

  it('attaches DOCS to the module with the closest path', () => {
    const files = [
      f('src/auth/login.ts', 'INTERESTING'),
      f('src/auth/session.ts', 'INTERESTING'),
      f('src/api/handler.ts', 'INTERESTING'),
      f('src/auth/README.md', 'DOCS'),
      f('src/api/CHANGELOG.md', 'DOCS'),
    ];
    const result = partition(files, { targetFilesPerModule: 2 });
    // Each dir should be its own module (2 files each)
    const authMod = result.modules.find(m => m.interesting.some(p => p.startsWith('src/auth')));
    const apiMod = result.modules.find(m => m.interesting.some(p => p.startsWith('src/api')));
    expect(authMod).toBeDefined();
    expect(apiMod).toBeDefined();
    expect(authMod!.docs).toContain('src/auth/README.md');
    expect(apiMod!.docs).toContain('src/api/CHANGELOG.md');
  });

  it('returns stable counts', () => {
    const files = [
      f('a.ts', 'INTERESTING'),
      f('b.ts', 'INTERESTING'),
      f('docs/intro.md', 'DOCS'),
      f('.git/x', 'TRASH'),
    ];
    const r = partition(files);
    expect(r.counts.interesting).toBe(2);
    expect(r.counts.docs).toBe(1);
    expect(r.counts.modules).toBe(r.modules.length);
  });

  it('empty input returns empty modules', () => {
    const r = partition([]);
    expect(r.modules).toHaveLength(0);
    expect(r.counts.interesting).toBe(0);
  });

  it('small repo with multiple dirs → still partitions (single-module shortcut removed)', () => {
    // 500 files across multiple directories — used to collapse into 1 "all" module.
    // Now always partitioned by directory for resilience. Use lower target so that
    // 200/200/100-file dirs each become their own module (avoid carry-coalescing).
    const files: ClassifiedFile[] = [];
    for (let i = 0; i < 200; i++) files.push(f(`src/auth/f${i}.ts`, 'INTERESTING'));
    for (let i = 0; i < 200; i++) files.push(f(`src/api/f${i}.ts`, 'INTERESTING'));
    for (let i = 0; i < 100; i++) files.push(f(`src/db/f${i}.ts`, 'INTERESTING'));
    files.push(f('README.md', 'DOCS'));

    const r = partition(files, { targetFilesPerModule: 100 });

    // Multiple modules now — directory partitioning always runs
    expect(r.modules.length).toBeGreaterThan(1);
    // All interesting files preserved across modules
    const allInteresting = r.modules.flatMap(m => m.interesting);
    expect(allInteresting).toHaveLength(500);
  });

  it('big repo → directory partitioning kicks in (multiple modules)', () => {
    // 3000 files — well above target
    const files: ClassifiedFile[] = [];
    for (let i = 0; i < 3000; i++) files.push(f(`big/dir/f${i}.ts`, 'INTERESTING'));

    const r = partition(files, { targetFilesPerModule: 1500, maxFilesPerModule: 2000 });

    expect(r.modules.length).toBeGreaterThan(1);
    // All files preserved
    const all = r.modules.flatMap(m => m.interesting);
    expect(all).toHaveLength(3000);
  });

  it('150 files at target=100 stays as ONE module (within tolerance)', () => {
    // Default max = ceil(target * 1.5) = 150 → 150 files should NOT split
    const files: ClassifiedFile[] = [];
    for (let i = 0; i < 150; i++) files.push(f(`src/all/f${i}.ts`, 'INTERESTING'));

    const r = partition(files, { targetFilesPerModule: 100 });

    expect(r.modules).toHaveLength(1);
    expect(r.modules[0].interesting).toHaveLength(150);
  });

  it('151 files at target=100 splits (just over tolerance)', () => {
    const files: ClassifiedFile[] = [];
    for (let i = 0; i < 151; i++) files.push(f(`src/all/f${i}.ts`, 'INTERESTING'));

    const r = partition(files, { targetFilesPerModule: 100 });

    // 151 > 150 → split into chunks of 100 → 2 modules (100 + 51)
    expect(r.modules).toHaveLength(2);
    expect(r.modules[0].interesting).toHaveLength(100);
    expect(r.modules[1].interesting).toHaveLength(51);
  });

  it('1998-file dir at target=100 splits into ~20 modules (phobos regression case)', () => {
    // Phobos module 5 had 1998 files in one Sniper invocation — context overflow,
    // crashed in 0.2s with "No result event found in stream output". With proper
    // splitting, a 1998-file dir at target=100 should produce 20 modules of ~100.
    const files: ClassifiedFile[] = [];
    for (let i = 0; i < 1998; i++) files.push(f(`big/dir/f${i}.ts`, 'INTERESTING'));

    const r = partition(files, { targetFilesPerModule: 100 });

    expect(r.modules.length).toBe(20);
    expect(r.modules.every(m => m.interesting.length <= 100)).toBe(true);
    const all = r.modules.flatMap(m => m.interesting);
    expect(all).toHaveLength(1998);
  });

  it('default max = target * 1.5 when not specified', () => {
    // target=500 → default max=750
    const files: ClassifiedFile[] = [];
    for (let i = 0; i < 750; i++) files.push(f(`src/x/f${i}.ts`, 'INTERESTING'));

    const r = partition(files, { targetFilesPerModule: 500 });
    expect(r.modules).toHaveLength(1);

    // 751 → splits
    const files2: ClassifiedFile[] = [];
    for (let i = 0; i < 751; i++) files2.push(f(`src/y/f${i}.ts`, 'INTERESTING'));
    const r2 = partition(files2, { targetFilesPerModule: 500 });
    expect(r2.modules.length).toBeGreaterThan(1);
  });
});
