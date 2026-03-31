import { useState } from 'react';
import { SEVERITIES } from '@/api/types';
import { TOOLS } from '@/lib/tool-mapping';

interface ExportDialogProps {
  open: boolean;
  repoCount: number;
  availableTools: string[];
  onExport: (severities: string[], tools: string[]) => void;
  onCancel: () => void;
}

export function ExportDialog({
  open,
  repoCount,
  availableTools,
  onExport,
  onCancel,
}: ExportDialogProps) {
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(new Set(SEVERITIES));
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set(availableTools));

  if (!open) return null;

  const toggleSeverity = (sev: string) => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev); else next.add(sev);
      return next;
    });
  };

  const toggleTool = (tool: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool); else next.add(tool);
      return next;
    });
  };

  const canExport = selectedSeverities.size > 0 && selectedTools.size > 0;

  const toolDisplayName = (key: string) =>
    TOOLS.find((t) => t.key === key)?.displayName ?? key;

  const handleExport = () => {
    onExport(Array.from(selectedSeverities), Array.from(selectedTools));
  };

  return (
    <div className="beast-overlay">
      <div className="beast-backdrop" onClick={onCancel} />
      <div className="beast-modal">
        <h3 className="beast-modal-title">Export Findings</h3>

        <div className="beast-modal-body">
          <p>
            Export active findings for <strong>{repoCount}</strong> {repoCount === 1 ? 'repository' : 'repositories'} as Markdown{repoCount > 1 ? ' (zip archive)' : ''}.
          </p>

          <div className="beast-export-section">
            <h4 className="beast-export-section-title">Severity</h4>
            <div className="beast-export-checks">
              {SEVERITIES.map((sev) => (
                <label key={sev} className="beast-export-check">
                  <input
                    type="checkbox"
                    className="beast-checkbox"
                    checked={selectedSeverities.has(sev)}
                    onChange={() => toggleSeverity(sev)}
                    aria-label={sev}
                  />
                  {sev}
                </label>
              ))}
            </div>
          </div>

          <div className="beast-export-section">
            <h4 className="beast-export-section-title">Tools</h4>
            <div className="beast-export-checks">
              {availableTools.map((tool) => (
                <label key={tool} className="beast-export-check">
                  <input
                    type="checkbox"
                    className="beast-checkbox"
                    checked={selectedTools.has(tool)}
                    onChange={() => toggleTool(tool)}
                    aria-label={toolDisplayName(tool)}
                  />
                  {toolDisplayName(tool)}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="beast-modal-actions">
          <button onClick={onCancel} className="beast-btn beast-btn-outline beast-btn-sm">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="beast-btn beast-btn-primary beast-btn-sm"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
