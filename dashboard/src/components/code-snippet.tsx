import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  cs: 'csharp', php: 'php', py: 'python', go: 'go',
  java: 'java', kt: 'kotlin', rb: 'ruby', rs: 'rust', swift: 'swift',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', json: 'json', xml: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  html: 'html', htm: 'html', css: 'css', scss: 'scss',
  md: 'markdown', dockerfile: 'docker', tf: 'hcl',
  vue: 'markup', svelte: 'markup',
  xaml: 'xml',
};

function detectLanguage(filePath: string | null | undefined): string {
  if (!filePath) return 'text';
  const lower = filePath.toLowerCase();
  if (lower.endsWith('dockerfile') || lower.includes('/dockerfile')) return 'docker';
  const ext = lower.split('.').pop() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? 'text';
}

interface ParsedLine {
  lineNum: number;
  isMatch: boolean;
  code: string;
}

/**
 * Parse the snippet format produced by extractCodeSnippet:
 *   "> 23 | private const string TOKEN = ..."  (matched line)
 *   "  16 | public string foo;"                (context)
 */
function parseSnippet(snippet: string): ParsedLine[] {
  const lines = snippet.split('\n');
  const result: ParsedLine[] = [];
  for (const raw of lines) {
    const m = raw.match(/^([> ])\s*(\d+)\s*\|\s?(.*)$/);
    if (m) {
      result.push({ lineNum: Number(m[2]), isMatch: m[1] === '>', code: m[3] });
    } else {
      // Fallback for malformed lines — render raw
      result.push({ lineNum: 0, isMatch: false, code: raw });
    }
  }
  return result;
}

export interface CodeSnippetProps {
  snippet: string;
  filePath?: string | null;
}

export function CodeSnippet({ snippet, filePath }: CodeSnippetProps) {
  const parsed = parseSnippet(snippet);
  const language = detectLanguage(filePath);
  const code = parsed.map(p => p.code).join('\n');
  const matchedLineIndices = new Set(
    parsed.map((p, i) => (p.isMatch ? i + 1 : null)).filter((x): x is number => x !== null),
  );

  return (
    <div className="beast-code-snippet-wrapper">
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        showLineNumbers
        startingLineNumber={parsed[0]?.lineNum || 1}
        wrapLines
        lineProps={(n: number) => {
          const idx = n - (parsed[0]?.lineNum || 1) + 1;
          return matchedLineIndices.has(idx)
            ? { className: 'beast-code-line-match' }
            : { className: 'beast-code-line' };
        }}
        customStyle={{
          margin: 0,
          padding: '12px 0',
          background: 'var(--th-surface)',
          fontSize: 12,
          maxWidth: '100%',
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono, 'Fira Code', 'Consolas', monospace)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
