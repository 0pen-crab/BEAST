import { describe, it, expect } from 'vitest';
import { generateFindingsMarkdown, generateFindingsCsv, cleanFilePath, type ExportFinding } from './export-findings';

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
  secretValue: null,
  createdAt: '2026-03-20T10:00:00Z',
  repositoryName: 'my-repo',
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

  it('includes secret value when present', () => {
    const finding = makeFinding({ secretValue: 'AKIAIOSFODNN7EXAMPLE' });
    const md = generateFindingsMarkdown('repo', [finding]);
    expect(md).toContain('**Secret:** `AKIAIOSFODNN7EXAMPLE`');
  });

  it('omits secret section when secretValue is null', () => {
    const finding = makeFinding({ secretValue: null });
    const md = generateFindingsMarkdown('repo', [finding]);
    expect(md).not.toContain('**Secret:**');
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

describe('generateFindingsCsv', () => {
  it('generates CSV with header row including Repository', () => {
    const csv = generateFindingsCsv([makeFinding()]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('ID,Repository,Title,Severity,Tool,Status,File,Line,CWE,CVSS,Secret,Description,Created');
  });

  it('generates correct data row with repository name', () => {
    const csv = generateFindingsCsv([makeFinding()]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 1 data row + trailing newline
    expect(lines[1]).toContain('my-repo');
    expect(lines[1]).toContain('Hardcoded secret in config');
    expect(lines[1]).toContain('High');
    expect(lines[1]).toContain('gitleaks');
  });

  it('escapes commas in fields', () => {
    const csv = generateFindingsCsv([makeFinding({ title: 'Title, with comma' })]);
    expect(csv).toContain('"Title, with comma"');
  });

  it('escapes double quotes in fields', () => {
    const csv = generateFindingsCsv([makeFinding({ title: 'Title with "quotes"' })]);
    expect(csv).toContain('"Title with ""quotes"""');
  });

  it('escapes newlines in fields', () => {
    const csv = generateFindingsCsv([makeFinding({ description: 'Line1\nLine2' })]);
    expect(csv).toContain('"Line1\nLine2"');
  });

  it('handles null optional fields', () => {
    const finding = makeFinding({
      filePath: null,
      line: null,
      cwe: null,
      cvssScore: null,
      description: null,
    });
    const csv = generateFindingsCsv([finding]);
    const lines = csv.split('\n');
    // Null fields should be empty
    expect(lines[1]).toContain(',,');
  });

  it('returns only header when no findings', () => {
    const csv = generateFindingsCsv([]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('ID,Repository,Title,Severity,Tool,Status,File,Line,CWE,CVSS,Secret,Description,Created');
    expect(lines[1]).toBe('');
  });

  it('cleans internal file path prefixes', () => {
    const finding = makeFinding({
      filePath: 'file:///workspace/my-repo.svc/repo/.git/config',
    });
    const csv = generateFindingsCsv([finding]);
    expect(csv).toContain('.git/config');
    expect(csv).not.toContain('file:///');
  });

  it('includes secret value in CSV column', () => {
    const csv = generateFindingsCsv([makeFinding({ secretValue: 'sk-secret123' })]);
    expect(csv).toContain('sk-secret123');
  });

  it('generates multiple data rows', () => {
    const findings = [
      makeFinding({ id: 1, title: 'First' }),
      makeFinding({ id: 2, title: 'Second' }),
      makeFinding({ id: 3, title: 'Third' }),
    ];
    const csv = generateFindingsCsv(findings);
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(4); // header + 3 rows
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
