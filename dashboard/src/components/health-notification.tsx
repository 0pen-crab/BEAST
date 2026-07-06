import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import { toast } from '@/lib/toast';

const POLL_INTERVAL_MS = 10_000;
const HEALTH_TOAST_ID = 'health-status';

/** One broken system, as reported by GET /api/health (503 body). */
interface SystemFailure {
  system: 'db' | 'worker' | 'claude-runner' | 'security-tools';
  message: string;
}

interface HealthState {
  status: 'ok' | 'degraded' | 'down' | 'unreachable';
  failures: SystemFailure[];
}

const HEALTHY: HealthState = { status: 'ok', failures: [] };

function sameState(a: HealthState, b: HealthState) {
  return (
    a.status === b.status &&
    a.failures.length === b.failures.length &&
    a.failures.every(
      (f, i) => f.system === b.failures[i].system && f.message === b.failures[i].message,
    )
  );
}

/**
 * Headless health watcher — renders no DOM of its own. Polls /api/health and
 * drives the shared toast stack: one persistent banner (updated in place)
 * while the backend is unreachable/degraded, auto-dismissed on recovery.
 */
export function HealthNotification() {
  const { t } = useTranslation();
  const [state, setState] = useState<HealthState>(HEALTHY);
  const inFlightRef = useRef(false);

  const check = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    let next: HealthState;
    try {
      const res = await apiFetch('/api/health');
      if (res.ok) {
        next = HEALTHY;
      } else {
        const body = await res.json().catch(() => ({}));
        const failures = Array.isArray(body?.failures) ? body.failures as SystemFailure[] : [];
        next = { status: body?.status === 'down' ? 'down' : 'degraded', failures };
      }
    } catch {
      next = { status: 'unreachable', failures: [] };
    } finally {
      inFlightRef.current = false;
    }
    // Keep the previous reference when nothing changed so the toast-sync
    // effect below only fires on real health transitions.
    setState((prev) => (sameState(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  useEffect(() => {
    if (state.status === 'ok') {
      toast.dismiss(HEALTH_TOAST_ID);
      return;
    }
    // Generic title; one detail line per failed system, prefixed with the
    // localized system name ("Worker: heartbeat is stale…").
    const showsFailures = state.status !== 'unreachable' && state.failures.length > 0;
    toast.show({
      id: HEALTH_TOAST_ID,
      kind: 'error',
      persistent: true,
      title: showsFailures ? t('health.degradedTitle') : t('health.title'),
      message: showsFailures
        ? state.failures.map((f) => `${t(`health.systems.${f.system}`, f.system)}: ${f.message}`)
        : t('health.detail'),
      action: { label: t('health.retry'), onClick: check },
    });
  }, [state, t, check]);

  // Remove the banner if the watcher itself unmounts.
  useEffect(() => () => toast.dismiss(HEALTH_TOAST_ID), []);

  return null;
}
