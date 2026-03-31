import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportDialog } from './export-dialog';

const defaultProps = {
  open: true,
  repoCount: 3,
  availableTools: ['beast', 'gitleaks', 'trivy-secrets'],
  onExport: vi.fn(),
  onCancel: vi.fn(),
};

describe('ExportDialog', () => {
  it('renders when open', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText(/export findings/i)).toBeTruthy();
  });

  it('does not render when closed', () => {
    render(<ExportDialog {...defaultProps} open={false} />);
    expect(screen.queryByText(/export findings/i)).toBeNull();
  });

  it('shows all severity checkboxes checked by default', () => {
    render(<ExportDialog {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox');
    // 5 severities + 3 tools = 8
    expect(checkboxes).toHaveLength(8);
    checkboxes.forEach((cb) => {
      expect((cb as HTMLInputElement).checked).toBe(true);
    });
  });

  it('calls onExport with selected severities and tools', () => {
    const onExport = vi.fn();
    render(<ExportDialog {...defaultProps} onExport={onExport} />);

    // Uncheck 'Info' severity
    const infoCheckbox = screen.getByLabelText('Info');
    fireEvent.click(infoCheckbox);

    // Uncheck 'gitleaks' tool
    const gitleaksCheckbox = screen.getByLabelText('Gitleaks');
    fireEvent.click(gitleaksCheckbox);

    fireEvent.click(screen.getByText(/export/i, { selector: 'button.beast-btn-primary' }));

    expect(onExport).toHaveBeenCalledWith(
      ['Critical', 'High', 'Medium', 'Low'],
      ['beast', 'trivy-secrets'],
    );
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<ExportDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when backdrop clicked', () => {
    const onCancel = vi.fn();
    render(<ExportDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(document.querySelector('.beast-backdrop')!);
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables export when no severities selected', () => {
    render(<ExportDialog {...defaultProps} />);
    // Uncheck all 5 severity checkboxes
    for (const label of ['Critical', 'High', 'Medium', 'Low', 'Info']) {
      fireEvent.click(screen.getByLabelText(label));
    }
    const exportBtn = screen.getByText(/export/i, { selector: 'button.beast-btn-primary' });
    expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables export when no tools selected', () => {
    render(<ExportDialog {...defaultProps} />);
    for (const label of ['BEAST', 'Gitleaks', 'Trivy']) {
      fireEvent.click(screen.getByLabelText(label));
    }
    const exportBtn = screen.getByText(/export/i, { selector: 'button.beast-btn-primary' });
    expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
