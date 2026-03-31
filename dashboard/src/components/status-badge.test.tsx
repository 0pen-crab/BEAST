import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, StatusLabel, getStatus } from './status-badge';
import type { Finding } from '@/api/types';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 1,
    testId: 1,
    repositoryId: 1,
    title: 'Test finding',
    severity: 'High',
    description: null,
    filePath: null,
    line: null,
    vulnIdFromTool: null,
    cwe: null,
    cvssScore: null,
    tool: 'beast',
    status: 'open',
    riskAcceptedReason: null,
    fingerprint: null,
    duplicateOf: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getStatus', () => {
  it('returns "Open" for status open', () => {
    expect(getStatus(makeFinding())).toBe('Open');
  });

  it('returns "Duplicate" for status duplicate', () => {
    expect(getStatus(makeFinding({ status: 'duplicate' }))).toBe('Duplicate');
  });

  it('returns "Risk Accepted" for status risk_accepted', () => {
    expect(getStatus(makeFinding({ status: 'risk_accepted' }))).toBe('Risk Accepted');
  });

  it('returns "False Positive" for status false_positive', () => {
    expect(getStatus(makeFinding({ status: 'false_positive' }))).toBe('False Positive');
  });

  it('returns "Fixed" for status fixed', () => {
    expect(getStatus(makeFinding({ status: 'fixed' }))).toBe('Fixed');
  });

  it('returns "Open" for unknown status', () => {
    expect(getStatus(makeFinding({ status: 'something_else' }))).toBe('Open');
  });
});

describe('StatusBadge', () => {
  it('renders the correct status text for an open finding', () => {
    render(<StatusBadge finding={makeFinding()} />);
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('renders "Risk Accepted" for risk_accepted finding', () => {
    render(<StatusBadge finding={makeFinding({ status: 'risk_accepted' })} />);
    expect(screen.getByText('Risk Accepted')).toBeInTheDocument();
  });

  it('renders "Duplicate" for duplicate finding', () => {
    render(<StatusBadge finding={makeFinding({ status: 'duplicate' })} />);
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<StatusBadge finding={makeFinding()} className="extra-class" />);
    const badge = screen.getByText('Open').closest('span');
    expect(badge?.className).toContain('extra-class');
  });
});

describe('StatusLabel', () => {
  it.each(['Open', 'Risk Accepted', 'False Positive', 'Fixed', 'Duplicate'] as const)(
    'renders "%s" label',
    (status) => {
      render(<StatusLabel status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
    },
  );

  it('applies custom className', () => {
    render(<StatusLabel status="Open" className="my-class" />);
    const badge = screen.getByText('Open').closest('span');
    expect(badge?.className).toContain('my-class');
  });
});
