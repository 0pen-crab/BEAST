import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SeverityBadge, SeverityCount } from './severity-badge';
import type { Severity } from '@/api/types';

describe('SeverityBadge', () => {
  const severities: Severity[] = ['Critical', 'High', 'Medium', 'Low', 'Info'];

  it.each(severities)('renders "%s" severity text', (severity) => {
    render(<SeverityBadge severity={severity} />);
    expect(screen.getByText(severity)).toBeInTheDocument();
  });

  it('renders count when provided', () => {
    render(<SeverityBadge severity="High" count={42} />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('does not render count when omitted', () => {
    const { container } = render(<SeverityBadge severity="Low" />);
    expect(container.querySelector('.beast-severity-count')).toBeNull();
  });

  it('applies custom className', () => {
    render(<SeverityBadge severity="Medium" className="my-custom" />);
    const badge = screen.getByText('Medium').closest('span');
    expect(badge?.className).toContain('my-custom');
  });

  it('defaults to sm size (no md class)', () => {
    render(<SeverityBadge severity="Critical" />);
    const badge = screen.getByText('Critical').closest('span');
    expect(badge?.className).not.toContain('beast-severity-md');
  });

  it('applies md size class', () => {
    render(<SeverityBadge severity="Critical" size="md" />);
    const badge = screen.getByText('Critical').closest('span');
    expect(badge?.className).toContain('beast-severity-md');
  });
});

describe('SeverityCount', () => {
  it('renders count when greater than zero', () => {
    render(<SeverityCount severity="High" count={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('returns null when count is zero', () => {
    const { container } = render(<SeverityCount severity="High" count={0} />);
    expect(container.innerHTML).toBe('');
  });
});
