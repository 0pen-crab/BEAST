import { cn } from '@/lib/utils';
import type { Finding } from '@/api/types';

const STATUS_DISPLAY: Record<string, FindingStatus> = {
  open: 'Open',
  false_positive: 'False Positive',
  fixed: 'Fixed',
  risk_accepted: 'Risk Accepted',
  duplicate: 'Duplicate',
};

const statusClass: Record<FindingStatus, string> = {
  Open: 'beast-status-open',
  'Risk Accepted': 'beast-status-accepted',
  'False Positive': 'beast-status-false-positive',
  Fixed: 'beast-status-fixed',
  Duplicate: 'beast-status-duplicate',
};

export type FindingStatus = 'Open' | 'Risk Accepted' | 'False Positive' | 'Fixed' | 'Duplicate';

export function getStatus(finding: Finding): FindingStatus {
  return STATUS_DISPLAY[finding.status] ?? 'Open';
}

interface StatusBadgeProps {
  finding: Finding;
  className?: string;
}

export function StatusBadge({ finding, className }: StatusBadgeProps) {
  const status = getStatus(finding);
  return (
    <span className={cn('beast-status', statusClass[status], className)}>
      {status}
    </span>
  );
}

/** Standalone status badge from string */
export function StatusLabel({ status, className }: { status: FindingStatus; className?: string }) {
  return (
    <span className={cn('beast-status', statusClass[status], className)}>
      {status}
    </span>
  );
}
