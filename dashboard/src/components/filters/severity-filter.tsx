import { cn } from '@/lib/utils';
import { SEVERITIES, type Severity } from '@/api/types';

const toggleClass: Record<Severity, string> = {
  Critical: 'beast-severity-toggle-critical',
  High: 'beast-severity-toggle-high',
  Medium: 'beast-severity-toggle-medium',
  Low: 'beast-severity-toggle-low',
  Info: 'beast-severity-toggle-info',
};

interface SeverityFilterProps {
  selected: Severity[];
  onChange: (selected: Severity[]) => void;
}

export function SeverityFilter({ selected, onChange }: SeverityFilterProps) {
  function toggle(s: Severity) {
    if (selected.includes(s)) {
      onChange(selected.filter((v) => v !== s));
    } else {
      onChange([...selected, s]);
    }
  }

  return (
    <div className="beast-flex-wrap beast-flex-gap-xs">
      {SEVERITIES.map((s) => {
        const isActive = selected.includes(s);
        return (
          <button
            key={s}
            onClick={() => toggle(s)}
            className={cn(
              'beast-severity-toggle',
              toggleClass[s],
              isActive && 'active',
            )}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}
