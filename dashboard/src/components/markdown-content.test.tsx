import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownContent } from './markdown-content';

describe('MarkdownContent', () => {
  it('renders plain text', () => {
    render(<MarkdownContent content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders bold text via markdown', () => {
    render(<MarkdownContent content="This is **bold** text" />);
    const bold = screen.getByText('bold');
    expect(bold.tagName).toBe('STRONG');
  });

  it('renders headings', () => {
    render(<MarkdownContent content="# Title" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Title');
  });

  it('renders links', () => {
    render(<MarkdownContent content="[click here](https://example.com)" />);
    const link = screen.getByRole('link', { name: 'click here' });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders inline code', () => {
    render(<MarkdownContent content="Use `npm install` to install" />);
    const code = screen.getByText('npm install');
    expect(code.tagName).toBe('CODE');
  });

  it('renders an unordered list', () => {
    render(<MarkdownContent content={'- item 1\n- item 2\n- item 3'} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
