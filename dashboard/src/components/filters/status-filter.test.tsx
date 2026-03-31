import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusFilter } from './status-filter';
import { STATUSES } from '@/api/types';

describe('StatusFilter', () => {
  it('renders a select element', () => {
    const onChange = vi.fn();
    render(<StatusFilter selected="All" onChange={onChange} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders "All Statuses" option plus each status', () => {
    const onChange = vi.fn();
    render(<StatusFilter selected="All" onChange={onChange} />);
    const options = screen.getAllByRole('option');
    // 1 "All Statuses" + 4 statuses = 5
    expect(options).toHaveLength(1 + STATUSES.length);
    expect(options[0]).toHaveTextContent('All Statuses');
  });

  it('has correct default value', () => {
    const onChange = vi.fn();
    render(<StatusFilter selected="All" onChange={onChange} />);
    expect(screen.getByRole('combobox')).toHaveValue('All');
  });

  it('displays the selected status', () => {
    const onChange = vi.fn();
    render(<StatusFilter selected="Open" onChange={onChange} />);
    expect(screen.getByRole('combobox')).toHaveValue('Open');
  });

  it('calls onChange when a new status is selected', () => {
    const onChange = vi.fn();
    render(<StatusFilter selected="All" onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Fixed' } });
    expect(onChange).toHaveBeenCalledWith('Fixed');
  });

  it('calls onChange with "All" when All Statuses is selected', () => {
    const onChange = vi.fn();
    render(<StatusFilter selected="Open" onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'All' } });
    expect(onChange).toHaveBeenCalledWith('All');
  });
});
