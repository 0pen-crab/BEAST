import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SeverityFilter } from './severity-filter';
import { SEVERITIES, type Severity } from '@/api/types';

describe('SeverityFilter', () => {
  it('renders all severity options as buttons', () => {
    const onChange = vi.fn();
    render(<SeverityFilter selected={[]} onChange={onChange} />);

    for (const s of SEVERITIES) {
      expect(screen.getByRole('button', { name: s })).toBeInTheDocument();
    }
  });

  it('calls onChange with severity added when clicking unselected option', () => {
    const onChange = vi.fn();
    render(<SeverityFilter selected={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'High' }));
    expect(onChange).toHaveBeenCalledWith(['High']);
  });

  it('calls onChange with severity removed when clicking selected option', () => {
    const onChange = vi.fn();
    render(<SeverityFilter selected={['High', 'Low']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'High' }));
    expect(onChange).toHaveBeenCalledWith(['Low']);
  });

  it('calls onChange adding to existing selection', () => {
    const onChange = vi.fn();
    render(<SeverityFilter selected={['Critical']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    expect(onChange).toHaveBeenCalledWith(['Critical', 'Medium']);
  });

  it('renders exactly 5 buttons', () => {
    const onChange = vi.fn();
    render(<SeverityFilter selected={[]} onChange={onChange} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });
});
