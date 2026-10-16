import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceUserOption } from '../api/types.ts';
import { fetchApi } from '../api/client.ts';
import { buildUrl } from '../api/hooks.ts';

interface UserSearchProps {
  workspaceId: number;
  onSelect: (user: WorkspaceUserOption) => void;
}

/**
 * Typeahead for picking an existing login account to add to a workspace.
 * Loads candidate users (those not already members) on focus and refines as
 * the admin types. Shares the `.beast-typeahead` styling with ContributorSearch.
 */
export function UserSearch({ workspaceId, onSelect }: UserSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkspaceUserOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLDivElement>(null);
  // Guards against a slow earlier response overwriting newer results.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!focused) return;

    clearTimeout(timerRef.current);
    const seq = ++requestSeqRef.current;
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetchApi<WorkspaceUserOption[]>(
          buildUrl(`/api/workspaces/${workspaceId}/users/search`, { q: query, limit: 10 }),
        );
        if (seq !== requestSeqRef.current) return; // stale response
        setResults(data);
        // Keep the dropdown open on zero results so the admin can tell
        // "no matching users" apart from a broken search.
        setOpen(true);
      } catch {
        if (seq !== requestSeqRef.current) return; // stale response
        setResults([]);
        setOpen(false);
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timerRef.current);
      // Invalidate any in-flight request on new input/unmount.
      requestSeqRef.current++;
    };
  }, [query, workspaceId, focused]);

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
    <div className="beast-typeahead" ref={wrapRef}>
      <input
        type="text"
        className="beast-input"
        placeholder={t('members.searchUserPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true); }}
      />
      {loading && <div className="beast-typeahead-loading" />}
      {open && (
        <ul className="beast-typeahead-dropdown">
          {results.length === 0 && (
            <li className="beast-typeahead-item beast-typeahead-empty">
              <span className="beast-typeahead-email">{t('members.noMatchingUsers', 'No matching users')}</span>
            </li>
          )}
          {results.map((u) => (
            <li
              key={u.id}
              className="beast-typeahead-item"
              onClick={() => {
                onSelect(u);
                setQuery('');
                setResults([]);
                setOpen(false);
              }}
            >
              <span className="beast-typeahead-name">{u.displayName ?? u.username}</span>
              {u.displayName && <span className="beast-typeahead-email">{u.username}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
