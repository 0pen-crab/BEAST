import type { Finding } from '@/api/types';

/** Subset of Finding fields needed for markdown export. */
export type ExportFinding = Pick<
  Finding,
  'id' | 'title' | 'severity' | 'tool' | 'status' | 'description' |
  'filePath' | 'line' | 'cwe' | 'cvssScore' | 'codeSnippet' | 'createdAt'
>;

const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;

/** Strip internal path prefixes to show clean relative paths. */
export function cleanFilePath(raw: string): string {
  return raw.replace(/^file:\/\/\/workspace\/[^/]+\/repo\//, '');
}

/** Generate a markdown report of findings for a single repository. */
export function generateFindingsMarkdown(repoName: string, findings: ExportFinding[]): string {
  const lines: string[] = [];
  const date = new Date().toISOString().slice(0, 10);

  lines.push(`# Security Findings: ${repoName}`);
  lines.push('');
  lines.push(`Exported: ${date}`);
  lines.push(`Total active findings: ${findings.length}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No active findings.');
    return lines.join('\n');
  }

  const bySeverity = new Map<string, ExportFinding[]>();
  for (const f of findings) {
    const group = bySeverity.get(f.severity) ?? [];
    group.push(f);
    bySeverity.set(f.severity, group);
  }

  for (const sev of SEVERITY_ORDER) {
    const group = bySeverity.get(sev);
    if (!group?.length) continue;

    lines.push(`## ${sev}`);
    lines.push('');

    for (const f of group) {
      lines.push(`### ${f.title}`);
      lines.push('');
      lines.push(`| | |`);
      lines.push(`|---|---|`);
      lines.push(`| **Tool:** | ${f.tool} |`);
      if (f.filePath) {
        const clean = cleanFilePath(f.filePath);
        const loc = f.line != null ? `${clean}:${f.line}` : clean;
        lines.push(`| **File:** | \`${loc}\` |`);
      }
      if (f.cwe != null) {
        lines.push(`| **CWE:** | CWE-${f.cwe} |`);
      }
      if (f.cvssScore != null) {
        lines.push(`| **CVSS:** | ${f.cvssScore} |`);
      }
      lines.push('');

      if (f.description) {
        lines.push(f.description);
        lines.push('');
      }

      if (f.codeSnippet) {
        lines.push('```');
        lines.push(f.codeSnippet);
        lines.push('```');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Trigger a blob download in the browser. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Trigger a text file download. */
export function downloadFile(filename: string, content: string, mimeType = 'text/markdown') {
  downloadBlob(filename, new Blob([content], { type: mimeType }));
}

/** Bundle multiple markdown files into a zip and download it. */
export async function downloadAsZip(
  files: { name: string; content: string }[],
  zipName: string,
) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.name, f.content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipName, blob);
}
