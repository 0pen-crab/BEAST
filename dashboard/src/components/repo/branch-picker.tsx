import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useRepositoryBranches, useUpdateRepository } from '@/api/hooks';

interface BranchPickerProps {
  repositoryId: number;
  /** Current default; null means "follow whatever the remote calls default". */
  value: string | null;
  /** Read-only for members who cannot edit the repository. */
  canEdit?: boolean;
}

/** "3 days ago" — enough to tell a live branch from an abandoned one. */
function relativeDay(iso: string, t: TFunction): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t('repo.branchToday');
  return t('repo.branchDaysAgo', { count: days });
}

/**
 * Picks the branch scans of this repository target.
 *
 * Branches are ranked by last commit, freshest first — commit count looked like
 * the right metric and was not: a feature branch inherits all the history it
 * forked from, so counts cluster within a few percent and rank forks above the
 * mainline. See repo-branches.ts.
 */
export function BranchPicker({ repositoryId, value, canEdit = true }: BranchPickerProps) {
  const { t } = useTranslation();
  const { data: branches, isLoading, isError } = useRepositoryBranches(repositoryId);
  const updateRepo = useUpdateRepository();

  // The saved branch may be missing from the list (deleted upstream, or the
  // clone predates it). Keep it selectable so the picker never silently shows
  // something other than what scans will actually use.
  const options = branches ?? [];
  const hasSaved = value !== null && options.some((b) => b.name === value);

  function handleChange(next: string) {
    if (next === (value ?? '')) return;
    updateRepo.mutate({ id: repositoryId, default_branch: next } as never);
  }

  if (isError) {
    return (
      <span className="beast-inline-picker" data-testid="branch-picker-error">
        <GitBranch className="beast-icon-sm" aria-hidden="true" />
        <span className="beast-inline-picker-label">
          {value ?? t('repo.branchUnknown')}
        </span>
      </span>
    );
  }

  return (
    <span className="beast-inline-picker" data-testid="branch-picker">
      <GitBranch className="beast-icon-sm" aria-hidden="true" />
      <label className="beast-inline-picker-label" htmlFor={`branch-${repositoryId}`}>
        {t('repo.branch')}
      </label>
      <select
        id={`branch-${repositoryId}`}
        className={`beast-select beast-select-sm beast-select-inline${
          updateRepo.isPending ? ' beast-select-busy' : ''
        }`}
        value={value ?? ''}
        disabled={!canEdit || isLoading}
        onChange={(e) => handleChange(e.target.value)}
      >
        <option value="">{t('repo.branchRemoteDefault')}</option>
        {value !== null && !hasSaved && <option value={value}>{value}</option>}
        {options.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name} · {relativeDay(b.lastCommitAt, t)}
          </option>
        ))}
      </select>
      {!isLoading && options.length === 0 && (
        <span className="beast-inline-picker-label">{t('repo.branchNeedsScan')}</span>
      )}
    </span>
  );
}
