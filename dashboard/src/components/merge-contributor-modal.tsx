import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Contributor } from '../api/contributor-types.ts';
import { ContributorSearch } from './contributor-search.tsx';
import { formatDate } from '../lib/format.ts';

interface SingleModeProps {
  mode: 'single';
  source: Contributor;
  candidates?: never;
  workspaceId: number;
  onConfirm: (sourceId: number, targetId: number) => void;
  onClose: () => void;
  loading?: boolean;
  error?: string | null;
}

interface BulkModeProps {
  mode: 'bulk';
  source?: never;
  candidates: Contributor[];
  workspaceId: number;
  onConfirm: (sourceIds: number[], targetId: number) => void;
  onClose: () => void;
  loading?: boolean;
  error?: string | null;
}

type MergeContributorModalProps = SingleModeProps | BulkModeProps;

export function MergeContributorModal(props: MergeContributorModalProps) {
  const { t } = useTranslation();
  const { mode, workspaceId, onClose, loading, error } = props;

  // Single mode: selected target from search
  const [selectedTarget, setSelectedTarget] = useState<Contributor | null>(null);

  // Bulk mode: which candidate is the target (default: most recently active)
  const [targetId, setTargetId] = useState<number>(() => {
    if (mode === 'bulk') {
      const sorted = [...props.candidates].sort((a, b) =>
        (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''),
      );
      return sorted[0]?.id ?? 0;
    }
    return 0;
  });

  const handleConfirm = () => {
    if (mode === 'single' && selectedTarget) {
      props.onConfirm(props.source.id, selectedTarget.id);
    } else if (mode === 'bulk') {
      const sourceIds = props.candidates.filter((c) => c.id !== targetId).map((c) => c.id);
      props.onConfirm(sourceIds, targetId);
    }
  };

  const canConfirm = mode === 'single' ? !!selectedTarget : targetId > 0;

  return (
    <div className="beast-overlay">
      <div className="beast-modal beast-modal-lg">
        <h2 className="beast-modal-title">
          {mode === 'single'
            ? t('contributors.mergeTitle')
            : t('contributors.mergeBulkTitle', { count: props.candidates.length })}
        </h2>

        <div className="beast-modal-body">
          {mode === 'single' && (
            <div className="beast-stack-sm">
              <div className="beast-merge-source">
                <span className="beast-avatar beast-avatar-xs">
                  {props.source.displayName.slice(0, 2).toUpperCase()}
                </span>
                <span className="beast-merge-source-name">{props.source.displayName}</span>
                <span className="beast-badge beast-badge-sm beast-badge-red">
                  {t('contributors.mergeSourceLabel')}
                </span>
              </div>

              <div className="beast-merge-arrow">→</div>

              {!selectedTarget ? (
                <ContributorSearch
                  workspaceId={workspaceId}
                  excludeIds={[props.source.id]}
                  onSelect={setSelectedTarget}
                />
              ) : (
                <div className="beast-merge-target">
                  <span className="beast-avatar beast-avatar-xs">
                    {selectedTarget.displayName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="beast-merge-target-name">{selectedTarget.displayName}</span>
                  <span className="beast-badge beast-badge-sm beast-badge-green">
                    {t('contributors.mergeTargetLabel')}
                  </span>
                  <button
                    className="beast-btn beast-btn-ghost beast-btn-xs"
                    onClick={() => setSelectedTarget(null)}
                  >
                    ✕
                  </button>
                </div>
              )}

              {selectedTarget && (
                <div className="beast-stack-xs">
                  <p className="beast-text-muted beast-text-sm">
                    {t('contributors.mergeTransfers')}
                  </p>
                  <div className="beast-error">
                    {t('contributors.mergeWarning', { name: props.source.displayName })}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === 'bulk' && (
            <div className="beast-stack-sm">
              <p className="beast-text-muted">{t('contributors.mergePickTarget')}</p>
              <div className="beast-merge-candidates">
                {[...props.candidates]
                  .sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
                  .map((c) => (
                  <label key={c.id} className="beast-merge-candidate">
                    <input
                      type="radio"
                      name="merge-target"
                      value={c.id}
                      checked={targetId === c.id}
                      onChange={() => setTargetId(c.id)}
                    />
                    <span className="beast-avatar beast-avatar-xs">
                      {c.displayName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="beast-merge-candidate-info">
                      <span className="beast-merge-candidate-name">{c.displayName}</span>
                      <span className="beast-merge-candidate-email">{c.emails[0]}</span>
                    </div>
                    <div className="beast-merge-candidate-stats">
                      <span>{c.totalCommits.toLocaleString()} commits</span>
                      {c.lastSeen && <span>{formatDate(c.lastSeen)}</span>}
                    </div>
                    {targetId === c.id && (
                      <span className="beast-badge beast-badge-sm beast-badge-green">
                        {t('contributors.mergeTargetLabel')}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <p className="beast-text-muted beast-text-sm">
                {t('contributors.mergeTransfers')}
              </p>
            </div>
          )}

          {error && <div className="beast-error">{error}</div>}
        </div>

        <div className="beast-modal-actions">
          <button className="beast-btn beast-btn-outline" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </button>
          <button
            className="beast-btn beast-btn-primary"
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
          >
            {loading ? t('common.saving') : t('contributors.mergeConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
