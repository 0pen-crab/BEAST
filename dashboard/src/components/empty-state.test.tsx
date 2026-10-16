import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No findings yet" />);
    expect(screen.getByText('No findings yet')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="Empty" description="Try adding something" />);
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.getByText('Try adding something')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);
    // Only one <p> for the title, no second for description
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(1);
  });

  it('renders the SVG icon', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
