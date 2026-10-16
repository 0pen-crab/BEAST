import { describe, it, expect, beforeEach } from 'vitest';
import { registerFindingTools } from './findings.ts';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

/** Minimal McpServer stand-in — captures what each tool registered. */
function registerTools() {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, Record<string, unknown>>();
  const server = {
    tool: (name: string, _desc: string, schema: Record<string, unknown>, handler: ToolHandler) => {
      handlers.set(name, handler);
      schemas.set(name, schema);
    },
  };
  registerFindingTools(server as never, 1);
  return { handlers, schemas };
}

describe('list_findings commit-date filters', () => {
  let listFindings: ToolHandler;
  let schema: Record<string, unknown>;

  beforeEach(() => {
    const { handlers, schemas } = registerTools();
    listFindings = handlers.get('list_findings')!;
    schema = schemas.get('list_findings')!;
  });

  it('accepts committed_after / committed_before parameters', () => {
    expect(schema.committed_after).toBeDefined();
    expect(schema.committed_before).toBeDefined();
  });

  // A silently-ignored bad date would answer "introduced after 13.01.2026"
  // with every finding in the workspace — the filter has to refuse instead.
  it('refuses an unparsable committed_after instead of ignoring it', async () => {
    const res = await listFindings({ committed_after: 'last january' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('committed_after');
    expect(res.content[0].text).toContain('last january');
  });

  it('refuses an unparsable committed_before instead of ignoring it', async () => {
    const res = await listFindings({ committed_before: 'yesterday-ish' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('committed_before');
  });
});
