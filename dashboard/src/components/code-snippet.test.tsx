import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CodeSnippet } from './code-snippet';

describe('CodeSnippet', () => {
  const sample = [
    '   16 |         public string molecule_batch_identifier { get; set; }',
    '   17 |         public string vcid { get; set; }',
    '>   23 |         private const string TOKEN = "abc";',
    '   24 |         public const string VAULT_ID = "6890";',
  ].join('\n');

  it('renders code lines from snippet', () => {
    const { container } = render(<CodeSnippet snippet={sample} filePath="src/CddWrapper.cs" />);
    expect(container.textContent).toContain('private const string TOKEN');
    expect(container.textContent).toContain('molecule_batch_identifier');
  });

  it('does not render the gutter "16 |" inline (line numbers come from highlighter)', () => {
    const { container } = render(<CodeSnippet snippet={sample} filePath="src/CddWrapper.cs" />);
    // The literal "23 |" pattern should NOT appear as code text — gutter parsed away.
    // (highlighter renders line numbers in its own column)
    expect(container.textContent).not.toMatch(/23 \|/);
  });

  it('handles empty snippet without crashing', () => {
    const { container } = render(<CodeSnippet snippet="" filePath="foo.ts" />);
    expect(container).toBeTruthy();
  });

  it('handles snippet without file path', () => {
    const { container } = render(<CodeSnippet snippet={sample} />);
    expect(container.textContent).toContain('TOKEN');
  });
});
