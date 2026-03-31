import { cn } from '@/lib/utils';
import type { Severity } from '@/api/types';

const severityClass: Record<Severity, string> = {
  Critical: 'beast-severity-critical',
  High: 'beast-severity-high',
  Medium: 'beast-severity-medium',
  Low: 'beast-severity-low',
  Info: 'beast-severity-info',
};

interface SeverityBadgeProps {
  severity: Severity;
  count?: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function SeverityBadge({ severity, count, className, size = 'sm' }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        'beast-severity',
        severityClass[severity],
        size === 'md' && 'beast-severity-md',
        size === 'lg' && 'beast-severity-lg',
        className,
      )}
    >
      {severity}
      {count !== undefined && (
        <span className="beast-severity-count">{count}</span>
      )}
    </span>
  );
}

/** Compact severity count pill (just number + color) */
export function SeverityCount({ severity, count }: { severity: Severity; count: number }) {
  if (count === 0) return null;
  return (
    <span className={cn('beast-severity', severityClass[severity])}>
      {count}
    </span>
  );
}
