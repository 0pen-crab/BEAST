/**
 * Load a persisted table-column selection from localStorage.
 *
 * Corrupt or legacy-format values SELF-HEAL: the bad key is removed so the
 * parse error can't recur on every page load, and defaults are returned.
 */
export function loadStoredColumns<T extends string>(key: string, defaults: readonly T[]): Set<T> {
  const stored = localStorage.getItem(key);
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return new Set(parsed as T[]);
      throw new Error('stored value is not an array');
    } catch (err) {
      console.warn(`[stored-columns] Corrupt column settings in "${key}" — resetting to defaults:`, err);
      localStorage.removeItem(key);
    }
  }
  return new Set(defaults);
}
