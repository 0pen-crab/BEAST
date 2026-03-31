import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Contributor } from '../api/contributor-types.ts';
import { fetchApi } from '../api/client.ts';
import { buildUrl } from '../api/hooks.ts';

interface ContributorSearchProps {
  workspaceId: number;
  excludeIds: number[];
  onSelect: (contributor: Contributor) => void;
}

export function ContributorSearch({ workspaceId, excludeIds, onSelect }: ContributorSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contributor[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetchApi<{ results: Contributor[] }>(
          buildUrl('/api/contributors', { workspace_id: workspaceId, search: query, limit: 10 }),
        );
        const filtered = data.results.filter((c) => !excludeIds.includes(c.id));
        setResults(filtered);
        setOpen(filtered.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timerRef.current);
  }, [query, workspaceId, excludeIds]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="beast-contributor-search" ref={wrapRef}>
      <input
        type="text"
        className="beast-input"
        placeholder={t('contributors.mergeSearchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {loading && <div className="beast-contributor-search-loading" />}
      {open && (
        <ul className="beast-contributor-search-dropdown">
          {results.map((c) => (
            <li
              key={c.id}
              className="beast-contributor-search-item"
              onClick={() => {
                onSelect(c);
                setQuery('');
                setOpen(false);
              }}
            >
              <span className="beast-avatar beast-avatar-xs">
                {c.displayName.slice(0, 2).toUpperCase()}
              </span>
              <span className="beast-contributor-search-name">{c.displayName}</span>
              <span className="beast-contributor-search-email">{c.emails[0]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
