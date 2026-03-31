import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusChangeDialog } from './status-change-dialog';

const defaultProps = {
  open: true,
  title: 'Confirm Action',
  description: 'Are you sure you want to proceed?',
  confirmLabel: 'Yes, proceed',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('StatusChangeDialog', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <StatusChangeDialog {...defaultProps} open={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders title and description when open', () => {
    render(<StatusChangeDialog {...defaultProps} />);
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
  });

  it('renders confirm button with custom label', () => {
    render(<StatusChangeDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Yes, proceed' })).toBeInTheDocument();
  });

  it('renders cancel button', () => {
    render(<StatusChangeDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<StatusChangeDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Yes, proceed' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<StatusChangeDialog {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <StatusChangeDialog {...defaultProps} onCancel={onCancel} />,
    );

    const backdrop = container.querySelector('.beast-backdrop');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
