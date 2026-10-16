import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSshExec, mockSshWriteFile, mockGetClaudeRunnerConfig } = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
  mockSshWriteFile: vi.fn().mockResolvedValue(undefined),
  mockGetClaudeRunnerConfig: vi.fn().mockReturnValue({
    host: 'claude-runner', port: 22, username: 'scanner', privateKey: Buffer.from('fake'),
  }),
}));

vi.mock('../ssh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssh.ts')>();
  return {
    ...actual,
    sshExec: mockSshExec,
    sshWriteFile: mockSshWriteFile,
    getClaudeRunnerConfig: mockGetClaudeRunnerConfig,
  };
});

import { classifyFile, loadMetadataJsonl, preClassifyAll } from './pre-classifier.ts';
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

describe('loadMetadataJsonl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses one FileMetadata per non-empty line', async () => {
    const line = JSON.stringify(meta({ path: 'src/a.ts' }));
    mockSshExec.mockResolvedValueOnce({ stdout: `${line}\n\n${line}\n`, stderr: '', code: 0 });

    const files = await loadMetadataJsonl('/workspace/scan-1/mirror/_metadata.jsonl');

    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('src/a.ts');
  });

  it('throws when the remote cat exits non-zero (missing metadata must not be silently treated as empty)', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'cat: /workspace/scan-1/mirror/_metadata.jsonl: No such file or directory',
      code: 1,
    });

    const err = await loadMetadataJsonl('/workspace/scan-1/mirror/_metadata.jsonl').then(
      () => { throw new Error('expected loadMetadataJsonl to throw'); },
      (e: unknown) => e as Error,
    );
    expect(err.message).toContain('exit 1');
    expect(err.message).toContain('No such file or directory');
  });

  it('tolerates a genuinely empty file (exit 0, empty stdout)', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    const files = await loadMetadataJsonl('/workspace/scan-1/mirror/_metadata.jsonl');

    expect(files).toEqual([]);
  });

  it('threads the cancel signal into the sshExec options', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });
    const controller = new AbortController();

    await loadMetadataJsonl('/workspace/scan-1/mirror/_metadata.jsonl', controller.signal);

    const options = mockSshExec.mock.calls[0][2] as Record<string, unknown>;
    expect(options.signal).toBe(controller.signal);
  });
});

describe('preClassifyAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads the cancel signal through to loadMetadataJsonl', async () => {
    const line = JSON.stringify(meta({ path: 'src/a.ts' }));
    mockSshExec.mockResolvedValueOnce({ stdout: `${line}\n`, stderr: '', code: 0 });
    const controller = new AbortController();

    await preClassifyAll('/workspace/scan-1/mirror/_metadata.jsonl', '/workspace/scan-1/classified.jsonl', controller.signal);

    const options = mockSshExec.mock.calls[0][2] as Record<string, unknown>;
    expect(options.signal).toBe(controller.signal);
  });

  it('threads the cancel signal into the classified-output sshWriteFile', async () => {
    const line = JSON.stringify(meta({ path: 'src/a.ts' }));
    mockSshExec.mockResolvedValueOnce({ stdout: `${line}\n`, stderr: '', code: 0 });
    const controller = new AbortController();

    await preClassifyAll('/workspace/scan-1/mirror/_metadata.jsonl', '/workspace/scan-1/classified.jsonl', controller.signal);

    expect(mockSshWriteFile).toHaveBeenCalledWith(
      expect.anything(),
      '/workspace/scan-1/classified.jsonl',
      expect.any(String),
      controller.signal,
    );
  });
});
