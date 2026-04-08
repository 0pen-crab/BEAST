import { useWorkerStatus } from '@/api/hooks';
import { useTranslation } from 'react-i18next';
import { useWorkspace } from '@/lib/workspace';

function formatTimeUntil(isoDate: string): string | null {
  const target = new Date(isoDate).getTime();
  if (isNaN(target)) return null;
  const diff = target - Date.now();
  if (diff <= 0) return null;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function RateLimitNotice() {
  const { data } = useWorkerStatus();
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();

  if (!data?.paused || data.reason !== 'rate_limit') return null;

  const hasAi = currentWorkspace && (
    currentWorkspace.aiAnalysisEnabled ||
    currentWorkspace.aiScanningEnabled ||
    currentWorkspace.aiTriageEnabled
  );
  if (!hasAi) return null;

  const timeLeft = data.resumesAt ? formatTimeUntil(data.resumesAt) : null;

  return (
    <div className="beast-topbar-alert">
      <div className="beast-topbar-alert-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
        </svg>
      </div>
      <div className="beast-topbar-alert-body">
        <span className="beast-topbar-alert-title">{t('worker.rateLimitPaused')}</span>
        <span className="beast-topbar-alert-sub">
          {t('worker.rateLimitDetail')}{timeLeft && <>. {t('worker.rateLimitResetsIn', { time: timeLeft })}</>}
        </span>
      </div>
    </div>
  );
}
