import { useWorkerStatus, useResumeWorker } from '@/api/hooks';
import { useTranslation } from 'react-i18next';
import { useWorkspace } from '@/lib/workspace';

export function RateLimitNotice() {
  const { data } = useWorkerStatus();
  const resume = useResumeWorker();
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();

  if (!data?.paused || data.reason !== 'rate_limit') return null;

  const hasAi = currentWorkspace && (
    currentWorkspace.aiAnalysisEnabled ||
    currentWorkspace.aiScanningEnabled ||
    currentWorkspace.aiTriageEnabled
  );
  if (!hasAi) return null;

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
        <span className="beast-topbar-alert-sub">{t('worker.rateLimitDetail')}</span>
      </div>
      <button
        className="beast-topbar-alert-action"
        onClick={() => resume.mutate()}
        disabled={resume.isPending}
      >
        {t('worker.forceResume')}
      </button>
    </div>
  );
}
