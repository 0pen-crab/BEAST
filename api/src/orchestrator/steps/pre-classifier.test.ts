import { describe, it, expect, vi } from 'vitest';
import { classifyFile } from './pre-classifier.ts';
import type { FileMetadata } from './pre-classifier.ts';

function meta(overrides: Partial<FileMetadata>): FileMetadata {
  return {
    path: 'src/main.ts',
    size_bytes: 1000,
    line_count: 50,
    mtime: 0,
    ext: 'ts',
    sha256_head_1kb: 'x',
    is_binary: false,
    avg_line_length: 20,
    ...overrides,
  };
}

describe('classifyFile hard rules', () => {
  it('binary → TRASH', () => {
    const r = classifyFile(meta({ is_binary: true, path: 'image.png' }));
    expect(r.bucket).toBe('TRASH');
    expect(r.reason).toContain('binary');
  });

  it('size > 2MB → TRASH', () => {
    const r = classifyFile(meta({ size_bytes: 3 * 1024 * 1024 }));
    expect(r.bucket).toBe('TRASH');
    expect(r.reason).toContain('size>');
  });

  it('avg_line_length > 500 → TRASH (minified)', () => {
    const r = classifyFile(meta({ avg_line_length: 800, path: 'app.js' }));
    expect(r.bucket).toBe('TRASH');
    expect(r.reason).toContain('minified');
  });

  it('single giant line (1 line, >10KB) → TRASH', () => {
    const r = classifyFile(meta({ line_count: 1, size_bytes: 50_000 }));
    expect(r.bucket).toBe('TRASH');
    expect(r.reason).toContain('single-giant-line');
  });

  it('normal small file with 0 lines (empty file) is NOT single-giant-line', () => {
    const r = classifyFile(meta({ line_count: 0, size_bytes: 100 }));
    expect(r.bucket).not.toBe('TRASH'); // should fall through to linguist
  });
});

describe('classifyFile linguist integration', () => {
  it('falls through to linguist for known source', () => {
    const r = classifyFile(meta({ path: 'src/auth/login.ts' }));
    expect(r.bucket).toBe('INTERESTING');
    expect(r.linguist_category).toBe('programming');
  });

  it('Designer.cs → TRASH via linguist', () => {
    const r = classifyFile(meta({ path: 'MainForm.Designer.cs' }));
    expect(r.bucket).toBe('TRASH');
    expect(r.linguist_category).toBe('generated');
  });

  it('README → DOCS', () => {
    const r = classifyFile(meta({ path: 'README.md' }));
    expect(r.bucket).toBe('DOCS');
  });

  it('node_modules → TRASH', () => {
    const r = classifyFile(meta({ path: 'node_modules/lodash/index.js' }));
    expect(r.bucket).toBe('TRASH');
  });

  it('unknown extension → UNCLEAR', () => {
    const r = classifyFile(meta({ path: 'data/weird.xyz987qqq' }));
    expect(r.bucket).toBe('UNCLEAR');
    expect(r.linguist_category).toBeNull();
  });
});

describe('classifyFile reason format', () => {
  it('hard rules prefix with "hard-rule:"', () => {
    const r = classifyFile(meta({ is_binary: true }));
    expect(r.reason).toMatch(/^hard-rule:/);
  });

  it('linguist classifications prefix with "linguist:"', () => {
    const r = classifyFile(meta({ path: 'src/x.ts' }));
    expect(r.reason).toMatch(/^linguist:/);
  });
});
