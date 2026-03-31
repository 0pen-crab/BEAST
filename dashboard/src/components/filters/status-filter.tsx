import { STATUSES, type Status } from '@/api/types';

interface StatusFilterProps {
  selected: Status | 'All';
  onChange: (status: Status | 'All') => void;
}

export function StatusFilter({ selected, onChange }: StatusFilterProps) {
  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value as Status | 'All')}
      className="beast-select beast-select-sm"
    >
      <option value="All">All Statuses</option>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
