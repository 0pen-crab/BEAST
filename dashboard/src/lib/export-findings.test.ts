import { describe, it, expect } from 'vitest';
import { generateFindingsMarkdown, cleanFilePath, type ExportFinding } from './export-findings';

const makeFinding = (overrides: Partial<ExportFinding> = {}): ExportFinding => ({
  id: 1,
  title: 'Hardcoded secret in config',
  severity: 'High',
  tool: 'gitleaks',
  status: 'open',
  description: 'A hardcoded API key was found.',
  filePath: 'src/config.ts',
  line: 42,
  cwe: 798,
  cvssScore: 8.5,
  codeSnippet: 'const API_KEY = "sk-1234";',
  createdAt: '2026-03-20T10:00:00Z',
  ...overrides,
});

describe('generateFindingsMarkdown', () => {
  it('generates markdown with repo name and date', () => {
    const md = generateFindingsMarkdown('my-repo', [makeFinding()]);
    expect(md).toContain('# Security Findings: my-repo');
    expect(md).toContain('Total active findings: 1');
  });

  it('groups findings by severity in correct order', () => {
    const findings = [
      makeFinding({ id: 1, severity: 'Low', title: 'Low issue' }),
      makeFinding({ id: 2, severity: 'Critical', title: 'Critical issue' }),
      makeFinding({ id: 3, severity: 'High', title: 'High issue' }),
      makeFinding({ id: 4, severity: 'Medium', title: 'Medium issue' }),
      makeFinding({ id: 5, severity: 'Info', title: 'Info issue' }),
    ];
    const md = generateFindingsMarkdown('repo', findings);

    const critIdx = md.indexOf('## Critical');
    const highIdx = md.indexOf('## High');
    const medIdx = md.indexOf('## Medium');
    const lowIdx = md.indexOf('## Low');
    const infoIdx = md.indexOf('## Info');

    expect(critIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(medIdx);
    expect(medIdx).toBeLessThan(lowIdx);
    expect(lowIdx).toBeLessThan(infoIdx);
  });

  it('omits severity sections with no findings', () => {
    const findings = [makeFinding({ severity: 'High' })];
    const md = generateFindingsMarkdown('repo', findings);

    expect(md).toContain('## High');
    expect(md).not.toContain('## Critical');
    expect(md).not.toContain('## Medium');
    expect(md).not.toContain('## Low');
    expect(md).not.toContain('## Info');
  });

  it('includes finding details', () => {
    const md = generateFindingsMarkdown('repo', [makeFinding()]);

    expect(md).toContain('### Hardcoded secret in config');
    expect(md).toContain('| **Tool:** | gitleaks |');
    expect(md).toContain('| **File:** | `src/config.ts:42` |');
    expect(md).toContain('| **CWE:** | CWE-798 |');
    expect(md).toContain('| **CVSS:** | 8.5 |');
    expect(md).toContain('A hardcoded API key was found.');
  });

  it('includes code snippet in fenced block', () => {
    const md = generateFindingsMarkdown('repo', [makeFinding()]);
    expect(md).toContain('```\nconst API_KEY = "sk-1234";\n```');
  });

  it('omits optional fields when null', () => {
    const finding = makeFinding({
      filePath: null,
      line: null,
      cwe: null,
      cvssScore: null,
      codeSnippet: null,
      description: null,
    });
    const md = generateFindingsMarkdown('repo', [finding]);

    expect(md).not.toContain('**File:**');
    expect(md).not.toContain('**CWE:**');
    expect(md).not.toContain('**CVSS:**');
    expect(md).not.toContain('```');
  });

  it('returns empty-state message when no findings', () => {
    const md = generateFindingsMarkdown('clean-repo', []);
    expect(md).toContain('# Security Findings: clean-repo');
    expect(md).toContain('No active findings');
  });

  it('shows file path without line when line is null', () => {
    const finding = makeFinding({ filePath: 'README.md', line: null });
    const md = generateFindingsMarkdown('repo', [finding]);
    expect(md).toContain('| **File:** | `README.md` |');
    expect(md).not.toContain('README.md:');
  });

  it('strips internal file:///workspace prefix from file paths', () => {
    const finding = makeFinding({
      filePath: 'file:///workspace/my-repo.svc/repo/.git/config',
      line: 7,
    });
    const md = generateFindingsMarkdown('repo', [finding]);
    expect(md).toContain('| **File:** | `.git/config:7` |');
    expect(md).not.toContain('file:///');
  });
});

describe('cleanFilePath', () => {
  it('strips file:///workspace/*/repo/ prefix', () => {
    expect(cleanFilePath('file:///workspace/my-app/repo/src/index.ts')).toBe('src/index.ts');
  });

  it('leaves plain relative paths unchanged', () => {
    expect(cleanFilePath('src/config.ts')).toBe('src/config.ts');
  });

  it('leaves absolute paths without prefix unchanged', () => {
    expect(cleanFilePath('/home/user/project/file.ts')).toBe('/home/user/project/file.ts');
  });
});
