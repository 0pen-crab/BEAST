import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';

const POLL_INTERVAL_MS = 10_000;

interface HealthIssue {
  message: string;
  source: string;
}

interface HealthState {
  status: 'ok' | 'degraded' | 'unreachable';
  issues: HealthIssue[];
}

const HEALTHY: HealthState = { status: 'ok', issues: [] };

export function HealthNotification() {
  const { t } = useTranslation();
  const [state, setState] = useState<HealthState>(HEALTHY);
  const inFlightRef = useRef(false);

  const check = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await apiFetch('/api/health');
      if (res.ok) {
        setState(HEALTHY);
      } else {
        const body = await res.json().catch(() => ({}));
        const issues = Array.isArray(body?.issues) ? body.issues as HealthIssue[] : [];
        setState({ status: 'degraded', issues });
      }
    } catch {
      setState({ status: 'unreachable', issues: [] });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  if (state.status === 'ok') return null;

  const showsIssues = state.status === 'degraded' && state.issues.length > 0;
  const title = showsIssues ? t('health.degradedTitle') : t('health.title');

  return (
    <div className="beast-notification-stack">
      <div className="beast-notification beast-notification-error" role="alert">
        <div className="beast-notification-content">
          <div className="beast-notification-title">{title}</div>
          {showsIssues ? (
            state.issues.map((issue, i) => (
              <div key={i} className="beast-notification-detail">{issue.message}</div>
            ))
          ) : (
            <div className="beast-notification-detail">{t('health.detail')}</div>
          )}
          <div className="beast-notification-actions">
            <button
              type="button"
              className="beast-btn beast-btn-outline beast-btn-sm"
              onClick={check}
            >
              {t('health.retry')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
