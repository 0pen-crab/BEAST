import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export type FilterColumn = {
  key: string;
  label: string;
  type?: 'select' | 'range';
  multi?: boolean;
  options: { value: string; label: string }[];
  minPlaceholder?: string;
  maxPlaceholder?: string;
};

export type ActiveFilter = {
  key: string;
  value: string;
  label: string;
  columnLabel: string;
};

type ChipFilterProps = {
  columns: FilterColumn[];
  activeFilters: ActiveFilter[];
  onAdd: (columnKey: string, value: string) => void;
  onRemove: (columnKey: string) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
};

export function ChipFilter({
  columns,
  activeFilters,
  onAdd,
  onRemove,
  searchValue,
  onSearchChange,
  searchPlaceholder,
}: ChipFilterProps) {
  const { t } = useTranslation();
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<FilterColumn | null>(null);
  const [rangeMin, setRangeMin] = useState('');
  const [rangeMax, setRangeMax] = useState('');
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetDropdown = () => {
    setShowColumnPicker(false);
    setSelectedColumn(null);
    setRangeMin('');
    setRangeMax('');
    setMultiSelected(new Set());
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        // If multi-select is open with selections, apply before closing
        if (selectedColumn?.multi && multiSelected.size > 0) {
          onAdd(selectedColumn.key, Array.from(multiSelected).join(','));
        }
        resetDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedColumn, multiSelected, onAdd]);

  const availableColumns = columns.filter(
    (col) => !activeFilters.some((f) => f.key === col.key),
  );

  const handleAddClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetDropdown();
    setShowColumnPicker((prev) => !prev);
  };

  const handleColumnPick = (col: FilterColumn) => {
    setShowColumnPicker(false);
    setSelectedColumn(col);
    setRangeMin('');
    setRangeMax('');
    setMultiSelected(new Set());
  };

  // Single-select: pick and close
  const handleValuePick = (value: string) => {
    if (selectedColumn) {
      onAdd(selectedColumn.key, value);
    }
    resetDropdown();
  };

  // Multi-select: toggle checkbox
  const handleMultiToggle = (value: string) => {
    setMultiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  // Multi-select: apply selection
  const handleMultiApply = () => {
    if (!selectedColumn || multiSelected.size === 0) return;
    onAdd(selectedColumn.key, Array.from(multiSelected).join(','));
    resetDropdown();
  };

  const handleRangeApply = () => {
    if (!selectedColumn || (!rangeMin && !rangeMax)) return;
    onAdd(selectedColumn.key, `${rangeMin || ''}..${rangeMax || ''}`);
    resetDropdown();
  };

  const isRange = selectedColumn?.type === 'range';
  const isMulti = selectedColumn?.multi === true;

  return (
    <div className="beast-dropdown-wrap" ref={wrapRef}>
      <div
        className="beast-filter-input"
        onClick={() => inputRef.current?.focus()}
      >
        {onSearchChange && (
          <input
            ref={inputRef}
            type="text"
            className="beast-filter-text"
            placeholder={searchPlaceholder}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        )}

        {activeFilters.map((filter) => (
          <span key={filter.key} className="beast-chip">
            <span className="beast-chip-key">{filter.columnLabel}</span>
            <span>{t('common.is', 'is')}</span>
            <span className="beast-chip-value">{filter.label}</span>
            <button
              className="beast-chip-remove"
              onClick={(e) => { e.stopPropagation(); onRemove(filter.key); }}
              title={t('common.remove', 'Remove')}
            >
              &times;
            </button>
          </span>
        ))}

        {availableColumns.length > 0 && (
          <button className="beast-filter-add" onClick={handleAddClick}>
            + {t('common.addFilter', 'Add filter')}
          </button>
        )}
      </div>

      {/* Column picker dropdown */}
      {showColumnPicker && (
        <div className="beast-filter-dropdown">
          <div className="beast-filter-dropdown-header">
            {t('common.filterByColumn', 'Filter by column')}
          </div>
          {availableColumns.map((col) => (
            <button
              key={col.key}
              className="beast-filter-dropdown-item"
              onClick={() => handleColumnPick(col)}
            >
              {col.label}
            </button>
          ))}
        </div>
      )}

      {/* Single-select value picker */}
      {selectedColumn && !isRange && !isMulti && (
        <div className="beast-filter-dropdown">
          <div className="beast-filter-dropdown-header">
            {selectedColumn.label}
          </div>
          {selectedColumn.options.map((opt) => (
            <button
              key={opt.value}
              className="beast-filter-dropdown-item"
              onClick={() => handleValuePick(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Multi-select value picker */}
      {selectedColumn && !isRange && isMulti && (
        <div className="beast-filter-dropdown">
          <div className="beast-filter-dropdown-header">
            {selectedColumn.label}
          </div>
          {selectedColumn.options.map((opt) => (
            <label key={opt.value} className="beast-filter-dropdown-check">
              <input
                type="checkbox"
                className="beast-checkbox"
                checked={multiSelected.has(opt.value)}
                onChange={() => handleMultiToggle(opt.value)}
              />
              {opt.label}
            </label>
          ))}
          <div className="beast-filter-range-actions">
            <button
              className="beast-btn beast-btn-primary beast-btn-sm"
              disabled={multiSelected.size === 0}
              onClick={handleMultiApply}
            >
              {t('common.apply', 'Apply')}
              {multiSelected.size > 0 && ` (${multiSelected.size})`}
            </button>
          </div>
        </div>
      )}

      {/* Range picker dropdown */}
      {selectedColumn && isRange && (
        <div className="beast-filter-dropdown">
          <div className="beast-filter-dropdown-header">
            {selectedColumn.label}
          </div>
          <div className="beast-filter-range">
            <input
              type="text"
              className="beast-input beast-input-sm"
              placeholder={selectedColumn.minPlaceholder ?? 'Min'}
              value={rangeMin}
              onChange={(e) => setRangeMin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRangeApply()}
              autoFocus
            />
            <span className="beast-filter-range-sep">&mdash;</span>
            <input
              type="text"
              className="beast-input beast-input-sm"
              placeholder={selectedColumn.maxPlaceholder ?? 'Max'}
              value={rangeMax}
              onChange={(e) => setRangeMax(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRangeApply()}
            />
          </div>
          <div className="beast-filter-range-actions">
            <button
              className="beast-btn beast-btn-primary beast-btn-sm"
              disabled={!rangeMin && !rangeMax}
              onClick={handleRangeApply}
            >
              {t('common.apply', 'Apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
