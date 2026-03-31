import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepProgress } from './step-progress';

describe('StepProgress', () => {
  // ── Structure ──────────────────────────────────────────────

  it('renders all steps with correct labels', () => {
    render(
      <StepProgress steps={[
        { label: 'Workspace', status: 'completed' },
        { label: 'Source', status: 'current' },
        { label: 'Import', status: 'pending' },
      ]} />
    );

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('shows connecting lines between steps', () => {
    const { container } = render(
      <StepProgress steps={[
        { label: 'A', status: 'completed' },
        { label: 'B', status: 'current' },
      ]} />
    );

    const lines = container.querySelectorAll('[data-testid="step-line"]');
    expect(lines.length).toBe(1);
  });

  it('does not show a line after the last step', () => {
    const { container } = render(
      <StepProgress steps={[
        { label: 'A', status: 'completed' },
        { label: 'B', status: 'current' },
        { label: 'C', status: 'pending' },
      ]} />
    );

    const lines = container.querySelectorAll('[data-testid="step-line"]');
    expect(lines.length).toBe(2);
  });

  it('renders sublabels when provided', () => {
    render(
      <StepProgress steps={[
        { label: 'Clone', status: 'completed', sublabel: '3s' },
      ]} />
    );

    expect(screen.getByText('3s')).toBeInTheDocument();
  });

  // ── Status styles ──────────────────────────────────────────

  it('applies completed styles', () => {
    render(<StepProgress steps={[{ label: 'Done', status: 'completed' }]} />);
    expect(screen.getByText('Done').className).toContain('beast-step-label-done');
  });

  it('applies current/active styles', () => {
    render(<StepProgress steps={[{ label: 'Now', status: 'current' }]} />);
    expect(screen.getByText('Now').className).toContain('beast-step-label-active');
  });

  it('applies running styles (same as active)', () => {
    render(<StepProgress steps={[{ label: 'Run', status: 'running' }]} />);
    expect(screen.getByText('Run').className).toContain('beast-step-label-active');
  });

  it('applies pending styles', () => {
    render(<StepProgress steps={[{ label: 'Later', status: 'pending' }]} />);
    expect(screen.getByText('Later').className).toContain('beast-step-label-pending');
  });

  it('applies failed styles', () => {
    render(<StepProgress steps={[{ label: 'Oops', status: 'failed' }]} />);
    expect(screen.getByText('Oops').className).toContain('beast-step-label-failed');
  });

  it('applies skipped styles', () => {
    render(<StepProgress steps={[{ label: 'Skip', status: 'skipped' }]} />);
    expect(screen.getByText('Skip').className).toContain('beast-step-label-skipped');
  });

  // ── Line colors ────────────────────────────────────────────

  it('uses active line after completed step', () => {
    const { container } = render(
      <StepProgress steps={[
        { label: 'A', status: 'completed' },
        { label: 'B', status: 'current' },
      ]} />
    );

    const line = container.querySelector('[data-testid="step-line"]');
    expect(line?.className).toContain('beast-step-line-done');
  });

  it('uses inactive line after non-completed step', () => {
    const { container } = render(
      <StepProgress steps={[
        { label: 'A', status: 'current' },
        { label: 'B', status: 'pending' },
      ]} />
    );

    const line = container.querySelector('[data-testid="step-line"]');
    expect(line?.className).toContain('beast-step-line-pending');
  });

  it('uses inactive line after failed step', () => {
    const { container } = render(
      <StepProgress steps={[
        { label: 'A', status: 'failed' },
        { label: 'B', status: 'pending' },
      ]} />
    );

    const line = container.querySelector('[data-testid="step-line"]');
    expect(line?.className).toContain('beast-step-line-pending');
  });

  // ── Click handling ─────────────────────────────────────────

  it('fires onStepClick for completed steps', () => {
    const onClick = vi.fn();
    render(
      <StepProgress
        steps={[
          { label: 'Done', status: 'completed' },
          { label: 'Now', status: 'current' },
        ]}
        onStepClick={onClick}
      />
    );

    fireEvent.click(screen.getByText('Done'));
    expect(onClick).toHaveBeenCalledWith(0);
  });

  it('does not fire onStepClick for pending steps', () => {
    const onClick = vi.fn();
    render(
      <StepProgress
        steps={[
          { label: 'Done', status: 'completed' },
          { label: 'Later', status: 'pending' },
        ]}
        onStepClick={onClick}
      />
    );

    fireEvent.click(screen.getByText('Later'));
    expect(onClick).not.toHaveBeenCalled();
  });

  // ── Size variant ───────────────────────────────────────────

  it('applies large dot size when size=lg', () => {
    const { container } = render(
      <StepProgress size="lg" steps={[{ label: 'A', status: 'completed' }]} />
    );

    const dot = container.querySelector('[data-testid="step-dot"]');
    expect(dot?.className).toContain('beast-step-dot-lg');
  });

  it('does not apply large dot size by default', () => {
    const { container } = render(
      <StepProgress steps={[{ label: 'A', status: 'completed' }]} />
    );

    const dot = container.querySelector('[data-testid="step-dot"]');
    expect(dot?.className).not.toContain('beast-step-dot-lg');
  });
});
