import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SEVERITIES, STATUSES } from '@/api/types';
import { TOOLS, TOOL_CATEGORIES } from '@/lib/tool-mapping';

export type ExportFormat = 'markdown' | 'csv';

export interface ToolCount {
  tool: string;
  active: number;
  dismissed: number;
}

interface ExportDialogProps {
  open: boolean;
  repoCount: number;
  toolCounts: ToolCount[];
  onExport: (severities: string[], tools: string[], statuses: string[], format: ExportFormat) => void;
  onCancel: () => void;
}

const DEFAULT_STATUSES = ['Open'];

export function ExportDialog({
  open,
  repoCount,
  toolCounts,
  onExport,
  onCancel,
}: ExportDialogProps) {
  const { t } = useTranslation();
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(new Set(SEVERITIES));
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(DEFAULT_STATUSES));
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ExportFormat>('csv');

  // Only tools that have findings in selected repos
  const relevantTools = useMemo(
    () => toolCounts.filter((tc) => tc.active + tc.dismissed > 0),
    [toolCounts],
  );

  // Select all tools when toolCounts loads/changes
  useEffect(() => {
    if (relevantTools.length > 0) {
      setSelectedTools(new Set(relevantTools.map((tc) => tc.tool)));
    }
  }, [toolCounts]);

  // Build a lookup of tool key → count
  const toolCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const tc of toolCounts) {
      map.set(tc.tool, tc.active + tc.dismissed);
    }
    return map;
  }, [toolCounts]);

  // Group ALL defined tools by category, with counts from the data
  const toolsByCategory = useMemo(() => {
    const map = new Map<string, { tool: string; displayName: string; total: number }[]>();
    for (const toolInfo of TOOLS) {
      const total = toolCountMap.get(toolInfo.key) ?? 0;
      const group = map.get(toolInfo.category) ?? [];
      group.push({
        tool: toolInfo.key,
        displayName: toolInfo.displayName,
        total,
      });
      map.set(toolInfo.category, group);
    }
    return map;
  }, [toolCountMap]);

  if (!open) return null;

  const toggle = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  const toggleAll = (set: Set<string>, allValues: string[]): Set<string> => {
    if (allValues.every((v) => set.has(v))) return new Set();
    return new Set(allValues);
  };

  const allSeveritiesSelected = SEVERITIES.every((s) => selectedSeverities.has(s));
  const allStatusesSelected = STATUSES.every((s) => selectedStatuses.has(s));
  const allToolsSelected = relevantTools.every((tc) => selectedTools.has(tc.tool));

  const canExport = selectedSeverities.size > 0 && selectedTools.size > 0 && selectedStatuses.size > 0;

  const handleExport = () => {
    const statusApiValues = Array.from(selectedStatuses).map((s) => {
      if (s === 'Open') return 'open';
      if (s === 'Risk Accepted') return 'risk_accepted';
      if (s === 'False Positive') return 'false_positive';
      if (s === 'Fixed') return 'fixed';
      if (s === 'Duplicate') return 'duplicate';
      return s;
    });
    onExport(
      Array.from(selectedSeverities),
      Array.from(selectedTools),
      statusApiValues,
      format,
    );
  };

  const toggleCategoryTools = (categoryKey: string) => {
    const group = toolsByCategory.get(categoryKey);
    if (!group) return;
    const toolKeys = group.filter((g) => g.total > 0).map((g) => g.tool);
    if (toolKeys.length === 0) return;
    const allSelected = toolKeys.every((k) => selectedTools.has(k));
    setSelectedTools((prev) => {
      const next = new Set(prev);
      for (const k of toolKeys) {
        if (allSelected) next.delete(k); else next.add(k);
      }
      return next;
    });
  };

  // All categories in defined order
  const visibleCategories = TOOL_CATEGORIES;

  return (
    <div className="beast-overlay">
      <div className="beast-backdrop" onClick={onCancel} />
      <div className="beast-modal beast-export-modal">
        <div className="beast-export-layout">
          {/* ── Left column: options ── */}
          <div className="beast-export-left">
            <div className="beast-export-col-header">
              <h3 className="beast-modal-title">{t('export.title', 'Export Findings')}</h3>
              <p className="beast-export-subtitle">
                {t('export.description', {
                  count: repoCount,
                  defaultValue: `Export findings from {{count}} ${repoCount === 1 ? 'repository' : 'repositories'}.`,
                })}
              </p>
            </div>
            {/* Format */}
            <div className="beast-export-section">
              <h4 className="beast-export-section-title">{t('export.format', 'Format')}</h4>
              <div className="beast-export-format-stack">
                <label className={`beast-export-format-option ${format === 'markdown' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="export-format"
                    checked={format === 'markdown'}
                    onChange={() => setFormat('markdown')}
                    aria-label="Markdown"
                  />
                  <span className="beast-export-format-label">Markdown</span>
                  <span className="beast-export-format-desc">{t('export.mdDesc', 'Human-readable report')}</span>
                </label>
                <label className={`beast-export-format-option ${format === 'csv' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="export-format"
                    checked={format === 'csv'}
                    onChange={() => setFormat('csv')}
                    aria-label="CSV"
                  />
                  <span className="beast-export-format-label">CSV</span>
                  <span className="beast-export-format-desc">{t('export.csvDesc', 'Spreadsheet-ready')}</span>
                </label>
              </div>
            </div>

            {/* Severity */}
            <div className="beast-export-section">
              <div className="beast-export-section-header">
                <h4 className="beast-export-section-title">{t('export.severity', 'Severity')}</h4>
                <button
                  type="button"
                  className="beast-export-toggle-all"
                  onClick={() => setSelectedSeverities(toggleAll(selectedSeverities, [...SEVERITIES]))}
                >
                  {allSeveritiesSelected ? t('common.deselectAll', 'Deselect all') : t('common.selectAll', 'Select all')}
                </button>
              </div>
              <div className="beast-export-checks beast-export-checks-col">
                {SEVERITIES.map((sev) => (
                  <label key={sev} className="beast-export-check">
                    <input
                      type="checkbox"
                      className="beast-checkbox"
                      checked={selectedSeverities.has(sev)}
                      onChange={() => setSelectedSeverities(toggle(selectedSeverities, sev))}
                      aria-label={sev}
                    />
                    {t(`severity.${sev}`, sev)}
                  </label>
                ))}
              </div>
            </div>

            {/* Status */}
            <div className="beast-export-section">
              <div className="beast-export-section-header">
                <h4 className="beast-export-section-title">{t('export.status', 'Status')}</h4>
                <button
                  type="button"
                  className="beast-export-toggle-all"
                  onClick={() => setSelectedStatuses(toggleAll(selectedStatuses, [...STATUSES]))}
                >
                  {allStatusesSelected ? t('common.deselectAll', 'Deselect all') : t('common.selectAll', 'Select all')}
                </button>
              </div>
              <div className="beast-export-checks beast-export-checks-col">
                {STATUSES.map((status) => (
                  <label key={status} className="beast-export-check">
                    <input
                      type="checkbox"
                      className="beast-checkbox"
                      checked={selectedStatuses.has(status)}
                      onChange={() => setSelectedStatuses(toggle(selectedStatuses, status))}
                      aria-label={status}
                    />
                    {t(`status.${status.replace(/\s+/g, '')}`, status)}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right column: tools by category ── */}
          <div className="beast-export-right">
            <div className="beast-export-col-header">
              <div className="beast-export-tools-header">
                <h4 className="beast-export-col-title">{t('export.tools', 'Tools')}</h4>
                {relevantTools.length > 1 && (
                  <button
                    type="button"
                    className="beast-export-toggle-all"
                    onClick={() => setSelectedTools(toggleAll(selectedTools, relevantTools.map((tc) => tc.tool)))}
                  >
                    {allToolsSelected ? t('common.deselectAll', 'Deselect all') : t('common.selectAll', 'Select all')}
                  </button>
                )}
              </div>
            </div>

            {relevantTools.length === 0 ? (
              <p className="beast-export-empty">{t('export.noTools', 'No tools with findings for selected repositories.')}</p>
            ) : (
              <div className="beast-export-categories">
                {visibleCategories.map((cat) => {
                  const group = toolsByCategory.get(cat.key)!;
                  const allCatSelected = group.every((g) => selectedTools.has(g.tool));
                  return (
                    <div key={cat.key} className="beast-export-cat">
                      <div className="beast-export-cat-header">
                        <span className="beast-export-cat-name">{cat.displayName}</span>
                        <button
                          type="button"
                          className="beast-export-toggle-all"
                          onClick={() => toggleCategoryTools(cat.key)}
                        >
                          {allCatSelected ? 'none' : 'all'}
                        </button>
                      </div>
                      <div className="beast-export-cat-tools">
                        {group.map((g) => {
                          const hasFindings = g.total > 0;
                          return (
                            <label key={g.tool} className={`beast-export-tool-item ${!hasFindings ? 'is-disabled' : ''}`}>
                              <input
                                type="checkbox"
                                className="beast-checkbox"
                                checked={hasFindings && selectedTools.has(g.tool)}
                                disabled={!hasFindings}
                                onChange={() => setSelectedTools(toggle(selectedTools, g.tool))}
                                aria-label={g.displayName}
                              />
                              <span className="beast-export-tool-name">{g.displayName}</span>
                              <span className="beast-export-count">{g.total}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="beast-modal-actions">
          <button onClick={onCancel} className="beast-btn beast-btn-outline beast-btn-sm">
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="beast-btn beast-btn-primary beast-btn-sm"
          >
            {t('common.export', 'Export')}
          </button>
        </div>
      </div>
    </div>
  );
}
