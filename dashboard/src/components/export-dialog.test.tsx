import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportDialog, type ToolCount } from './export-dialog';

// Minimal i18n mock — returns key or fallback
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) return fallback.defaultValue as string;
      return key;
    },
  }),
}));

const toolCounts: ToolCount[] = [
  { tool: 'beast', active: 5, dismissed: 1 },
  { tool: 'gitleaks', active: 3, dismissed: 0 },
  { tool: 'semgrep', active: 10, dismissed: 2 },
];

const defaultProps = {
  open: true,
  repoCount: 3,
  toolCounts,
  onExport: vi.fn(),
  onCancel: vi.fn(),
};

describe('ExportDialog', () => {
  it('renders when open', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByRole('heading', { name: /export findings/i })).toBeTruthy();
  });

  it('does not render when closed', () => {
    render(<ExportDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('heading', { name: /export findings/i })).toBeNull();
  });

  it('shows all severity checkboxes checked by default', () => {
    render(<ExportDialog {...defaultProps} />);
    for (const sev of ['Critical', 'High', 'Medium', 'Low', 'Info']) {
      expect((screen.getByLabelText(sev) as HTMLInputElement).checked).toBe(true);
    }
  });

  it('shows only Open status checked by default', () => {
    render(<ExportDialog {...defaultProps} />);
    expect((screen.getByLabelText('Open') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Risk Accepted') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('False Positive') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Fixed') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Duplicate') as HTMLInputElement).checked).toBe(false);
  });

  it('shows tools with findings as enabled, tools without as disabled', () => {
    render(<ExportDialog {...defaultProps} />);
    // Tools with findings are enabled
    expect((screen.getByLabelText('BEAST') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('Gitleaks') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('Semgrep') as HTMLInputElement).disabled).toBe(false);
    // Tools without findings are disabled
    expect((screen.getByLabelText('Trufflehog') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Checkov') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows finding counts next to tools', () => {
    render(<ExportDialog {...defaultProps} />);
    // beast: 5+1=6, gitleaks: 3, semgrep: 10+2=12
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('shows empty state when no tools have findings', () => {
    render(<ExportDialog {...defaultProps} toolCounts={[]} />);
    expect(screen.getByText(/no tools with findings/i)).toBeTruthy();
  });

  it('groups tools by category', () => {
    render(<ExportDialog {...defaultProps} />);
    // BEAST and Semgrep are SAST (Code Analysis), Gitleaks is Secrets
    expect(screen.getByText('Code Analysis')).toBeTruthy();
    expect(screen.getByText('Secrets')).toBeTruthy();
  });

  it('calls onExport with severities, tools, statuses, and format', () => {
    const onExport = vi.fn();
    render(<ExportDialog {...defaultProps} onExport={onExport} />);

    // Uncheck 'Info' severity
    fireEvent.click(screen.getByLabelText('Info'));

    // Also check 'Risk Accepted' status
    fireEvent.click(screen.getByLabelText('Risk Accepted'));

    // Uncheck 'Gitleaks' tool
    fireEvent.click(screen.getByLabelText('Gitleaks'));

    fireEvent.click(screen.getByText(/export/i, { selector: 'button.beast-btn-primary' }));

    expect(onExport).toHaveBeenCalledWith(
      ['Critical', 'High', 'Medium', 'Low'],
      expect.arrayContaining(['beast', 'semgrep']),
      expect.arrayContaining(['open', 'risk_accepted']),
      'csv',
    );
    expect(onExport.mock.calls[0][1]).not.toContain('gitleaks');
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
    for (const label of ['Critical', 'High', 'Medium', 'Low', 'Info']) {
      fireEvent.click(screen.getByLabelText(label));
    }
    const exportBtn = screen.getByText(/export/i, { selector: 'button.beast-btn-primary' });
    expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables export when no tools selected', () => {
    render(<ExportDialog {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('BEAST'));
    fireEvent.click(screen.getByLabelText('Gitleaks'));
    fireEvent.click(screen.getByLabelText('Semgrep'));
    const exportBtn = screen.getByText(/export/i, { selector: 'button.beast-btn-primary' });
    expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables export when no statuses selected', () => {
    render(<ExportDialog {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Open'));
    const exportBtn = screen.getByText(/export/i, { selector: 'button.beast-btn-primary' });
    expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows format cards defaulting to CSV', () => {
    render(<ExportDialog {...defaultProps} />);
    const csvRadio = screen.getByLabelText('CSV') as HTMLInputElement;
    const mdRadio = screen.getByLabelText('Markdown') as HTMLInputElement;
    expect(csvRadio.checked).toBe(true);
    expect(mdRadio.checked).toBe(false);
  });

  it('passes selected format to onExport', () => {
    const onExport = vi.fn();
    render(<ExportDialog {...defaultProps} onExport={onExport} />);
    fireEvent.click(screen.getByLabelText('Markdown'));
    fireEvent.click(screen.getByText(/export/i, { selector: 'button.beast-btn-primary' }));
    expect(onExport).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      'markdown',
    );
  });

  it('maps status display names to API values', () => {
    const onExport = vi.fn();
    render(<ExportDialog {...defaultProps} onExport={onExport} />);
    fireEvent.click(screen.getByLabelText('False Positive'));
    fireEvent.click(screen.getByLabelText('Risk Accepted'));
    fireEvent.click(screen.getByText(/export/i, { selector: 'button.beast-btn-primary' }));
    const statuses = onExport.mock.calls[0][2];
    expect(statuses).toContain('open');
    expect(statuses).toContain('false_positive');
    expect(statuses).toContain('risk_accepted');
  });
});
