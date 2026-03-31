import { useState, useCallback } from 'react';

const STORAGE_KEY = 'beast_onboarding';

interface WizardStorage {
  workspaceId: number | null;
  maxStep: number;
  steps: Record<string, unknown>;
}

/**
 * Load wizard state from localStorage.
 * Matching rules:
 *  - workspaceId=null (step 1, pre-creation) → always matches
 *  - workspaceId=N with stored null → matches (draft upgraded to real)
 *  - workspaceId=N with stored N → matches (exact)
 *  - workspaceId=N with stored M (M≠N) → rejected (different workspace)
 */
function load(workspaceId: number | null): WizardStorage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: WizardStorage = JSON.parse(raw);
    if (
      workspaceId !== null &&
      data.workspaceId !== null &&
      data.workspaceId !== workspaceId
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function save(data: WizardStorage) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearWizardState() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Persist a piece of wizard state in localStorage.
 * Works with workspaceId=null (step 1 draft) — no data is lost.
 * When workspaceId transitions from null → real, stored state is upgraded automatically.
 */
export function useWizardStepState<T>(
  workspaceId: number | null,
  stepKey: string,
  initialValue: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValueRaw] = useState<T>(() => {
    const stored = load(workspaceId);
    if (stored?.steps[stepKey] !== undefined) {
      return stored.steps[stepKey] as T;
    }
    return initialValue;
  });

  const setValue = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValueRaw((prev) => {
        const next = typeof v === 'function' ? (v as (prev: T) => T)(prev) : v;
        const stored = load(workspaceId) ?? { workspaceId, maxStep: 1, steps: {} };
        // Upgrade draft → real workspaceId when available
        if (workspaceId !== null) stored.workspaceId = workspaceId;
        stored.steps[stepKey] = next;
        save(stored);
        return next;
      });
    },
    [workspaceId, stepKey],
  );

  return [value, setValue];
}

/**
 * Persist maxStep in localStorage.
 * Same null-safe semantics as useWizardStepState.
 */
export function useWizardMaxStep(
  workspaceId: number | null,
  initialMax: number,
): [number, (v: number) => void] {
  const [maxStep, setMaxStepRaw] = useState<number>(() => {
    const stored = load(workspaceId);
    return stored ? Math.max(stored.maxStep, initialMax) : initialMax;
  });

  const setMaxStep = useCallback(
    (v: number) => {
      setMaxStepRaw((prev) => {
        const next = Math.max(prev, v);
        const stored = load(workspaceId) ?? { workspaceId, maxStep: 1, steps: {} };
        if (workspaceId !== null) stored.workspaceId = workspaceId;
        stored.maxStep = next;
        save(stored);
        return next;
      });
    },
    [workspaceId],
  );

  return [maxStep, setMaxStep];
}
