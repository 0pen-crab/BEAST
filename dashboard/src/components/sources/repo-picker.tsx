import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportFromSource } from '@/api/hooks';
import type { DiscoveredRepo } from '@/api/types';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

interface RepoPickerProps {
  repos: DiscoveredRepo[];
  sourceId: number;
  onImported: (count: number) => void;
  selectionMode?: boolean;
  selected?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
}

export function RepoPicker({
  repos, sourceId, onImported,
  selectionMode, selected: externalSelected, onSelectionChange,
}: RepoPickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const importMutation = useImportFromSource();

  const selected = selectionMode ? (externalSelected ?? new Set<string>()) : internalSelected;

  function updateSelection(next: Set<string>) {
    if (selectionMode && onSelectionChange) {
      onSelectionChange(next);
    } else {
      setInternalSelected(next);
    }
  }

  const importableRepos = repos.filter(r => !r.imported);
  const filtered = repos
    .filter(r =>
      r.slug.toLowerCase().includes(search.toLowerCase()) ||
      (r.fullName && r.fullName.toLowerCase().includes(search.toLowerCase())),
    )
    .sort((a, b) => (a.imported === b.imported ? 0 : a.imported ? -1 : 1));

  function toggleRepo(slug: string) {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    updateSelection(next);
  }

  function selectAll() {
    updateSelection(new Set(importableRepos.map(r => r.slug)));
  }

  function deselectAll() {
    updateSelection(new Set());
  }

  function handleImportSelected() {
    if (selected.size === 0) return;
    importMutation.mutate(
      { sourceId, repos: Array.from(selected) },
      { onSuccess: (data) => onImported(data.imported) },
    );
  }

  function handleImportAll() {
    importMutation.mutate(
      { sourceId, repos: importableRepos.map(r => r.slug) },
      { onSuccess: (data) => onImported(data.imported) },
    );
  }

  return (
    <div className="space-y-3">
      {/* Header: search + actions */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          className="beast-input beast-input-sm flex-1"
          placeholder={t('repoPicker.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!selectionMode && (
          <button
            onClick={handleImportAll}
            disabled={importMutation.isPending || importableRepos.length === 0}
            className="beast-btn beast-btn-primary beast-btn-sm whitespace-nowrap"
          >
            {importMutation.isPending ? t('repoPicker.importing') : t('repoPicker.importAll')}
          </button>
        )}
      </div>

      {/* Select all / deselect all */}
      <div className="flex items-center gap-3 text-xs text-th-text-muted">
        <button onClick={selectAll} className="hover:text-beast-red uppercase tracking-wider font-semibold text-[11px]">{t('repoPicker.selectAll')}</button>
        <span>|</span>
        <button onClick={deselectAll} className="hover:text-beast-red uppercase tracking-wider font-semibold text-[11px]">{t('repoPicker.deselectAll')}</button>
        {!selectionMode && selected.size > 0 && (
          <>
            <span className="ml-auto" />
            <button
              onClick={handleImportSelected}
              disabled={importMutation.isPending}
              className="beast-btn beast-btn-sm bg-beast-red/15 text-beast-red-light hover:bg-beast-red/25 disabled:opacity-50"
            >
              {t('repoPicker.importSelected', { count: selected.size })}
            </button>
          </>
        )}
      </div>

      {/* Repo list */}
      <div className="max-h-80 overflow-y-auto border border-th-border divide-y divide-th-border-subtle">
        {filtered.map(repo => (
          <label
            key={repo.slug}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-th-hover transition-colors',
              repo.imported && 'opacity-60 cursor-not-allowed',
            )}
          >
            <input
              type="checkbox"
              className="h-4 w-4 border-th-border text-beast-red focus:ring-beast-red accent-beast-red"
              checked={repo.imported || selected.has(repo.slug)}
              disabled={repo.imported}
              onChange={() => toggleRepo(repo.slug)}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-th-text truncate">{repo.slug}</div>
              {repo.description && (
                <div className="text-xs text-th-text-muted truncate">{repo.description}</div>
              )}
              {(repo.primaryLanguage || repo.sizeBytes != null) && (
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-th-text-muted">
                  {repo.primaryLanguage && <span className="text-blue-400">{repo.primaryLanguage}</span>}
                  {repo.primaryLanguage && repo.sizeBytes != null && <span>·</span>}
                  {repo.sizeBytes != null && <span>{formatBytes(repo.sizeBytes)}</span>}
                </div>
              )}
            </div>
            {repo.imported && (
              <span className="beast-badge beast-badge-red">
                {t('repoPicker.imported')}
              </span>
            )}
          </label>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-th-text-muted">
            No repositories found
          </div>
        )}
      </div>
    </div>
  );
}
