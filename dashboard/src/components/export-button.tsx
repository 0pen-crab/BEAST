import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspace } from '@/lib/workspace';
import { apiFetch } from '@/api/client';
import { useFindingCountsByTool } from '@/api/hooks';
import { downloadBlob, generateFindingsMarkdown, generateFindingsCsv, downloadAsZip, type ExportFinding } from '@/lib/export-findings';
import { ExportDialog, type ExportFormat } from '@/components/export-dialog';
import { cn } from '@/lib/utils';
import type { Finding } from '@/api/types';

interface Scope {
  /**
   * - 'workspace' — Dashboard, export across the whole workspace
   * - 'repo'      — single repository page
   */
  type: 'workspace' | 'repo';
  repositoryId?: number;
  repositoryName?: string;
}

type AiJobState =
  | { phase: 'idle' }
  | { phase: 'processing'; jobId: string; raw?: boolean }
  | { phase: 'done'; jobId: string }
  | { phase: 'error'; message: string };

interface ExportButtonProps {
  scope: Scope;
  /** Override the button label. Defaults to t('export.button'). */
  label?: string;
}

/**
 * Unified Export button + modal. Replaces the workspace/repo-specific
 * "Security Brief" buttons with a single flow that supports both raw export
 * (CSV/Markdown) and AI-curated brief (Claude picks the 10–30 most critical
 * findings via the highlights endpoint).
 */
export function ExportButton({ scope, label }: ExportButtonProps) {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const [open, setOpen] = useState(false);
  const [aiJob, setAiJob] = useState<AiJobState>({ phase: 'idle' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const repoIds = scope.type === 'repo' && scope.repositoryId !== undefined ? [scope.repositoryId] : undefined;

  // Pre-load tool counts for the modal (so it can show counts per tool).
  // Workspace scope = no filter, repo scope = filter to one repo.
  const { data: toolCounts = [] } = useFindingCountsByTool(repoIds);

  // Cleanup interval on unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // Resume an in-flight AI job if one exists for this scope (mount).
  const scopeQuery = scope.type === 'repo' && scope.repositoryId
    ? `&repository_id=${scope.repositoryId}`
    : '';
  useEffect(() => {
    if (!wsId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/highlights/latest?workspace_id=${wsId}${scopeQuery}`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as { job: { id: string; status: string; error?: string } | null };
        if (!data.job || cancelled) return;
        if (data.job.status === 'processing') {
          setAiJob({ phase: 'processing', jobId: data.job.id });
          startPolling(data.job.id);
        } else if (data.job.status === 'done') {
          setAiJob({ phase: 'done', jobId: data.job.id });
        }
      } catch {
        if (!cancelled) {
          setAiJob({ phase: 'error', message: t('export.aiFailed', 'AI export failed') });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, scopeQuery]);

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/highlights/${jobId}?workspace_id=${wsId}`);
        if (!res.ok) {
          clearInterval(pollRef.current!);
          setAiJob({ phase: 'error', message: t('export.aiFailed', 'AI export failed') });
          return;
        }
        const data = await res.json() as { status: string; error?: string };
        if (data.status === 'done') {
          clearInterval(pollRef.current!);
          setAiJob({ phase: 'done', jobId });
          autoDownloadAi(jobId);
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current!);
          setAiJob({ phase: 'error', message: data.error ?? t('export.aiFailed', 'AI export failed') });
        }
      } catch {
        clearInterval(pollRef.current!);
        setAiJob({ phase: 'error', message: t('export.aiFailed', 'AI export failed') });
      }
    }, 3000);
  }, [wsId, t]);

  const autoDownloadAi = useCallback(async (jobId: string) => {
    if (!wsId) return;
    try {
      const res = await apiFetch(`/api/highlights/${jobId}/download?workspace_id=${wsId}`);
      if (!res.ok) {
        setAiJob({ phase: 'error', message: t('export.downloadFailed', 'Download failed') });
        return;
      }
      const blob = await res.blob();
      const date = new Date().toISOString().slice(0, 10);
      const slug = scope.repositoryName
        ? scope.repositoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        : null;
      const fileName = slug
        ? `security-brief-${slug}-${date}.csv`
        : `security-brief-${date}.csv`;
      downloadBlob(fileName, blob);
    } catch {
      setAiJob({ phase: 'error', message: t('export.downloadFailed', 'Download failed') });
    }
  }, [wsId, scope.repositoryName, t]);

  // ── AI-curated export ─────────────────────────────────────
  const handleAiExport = useCallback(async (
    severities: string[],
    tools: string[],
    statuses: string[],
  ) => {
    if (!wsId) return;
    setOpen(false);
    setAiJob({ phase: 'processing', jobId: '' });

    const params = new URLSearchParams({ workspace_id: String(wsId) });
    if (scope.type === 'repo' && scope.repositoryId !== undefined) {
      params.set('repository_id', String(scope.repositoryId));
    }
    if (severities.length) params.set('severity_filter', severities.join(','));
    if (tools.length) params.set('tool_filter', tools.join(','));
    if (statuses.length) params.set('status_filter', statuses.join(','));

    try {
      const res = await apiFetch(`/api/highlights/generate?${params}`, { method: 'POST' });
      const data = await res.json() as { jobId?: string; error?: string; message?: string };
      if (!res.ok || !data.jobId) {
        setAiJob({
          phase: 'error',
          message: data.message ?? data.error ?? t('export.aiFailed', 'AI export failed'),
        });
        return;
      }
      setAiJob({ phase: 'processing', jobId: data.jobId });
      startPolling(data.jobId);
    } catch {
      setAiJob({ phase: 'error', message: t('export.aiFailed', 'AI export failed') });
    }
  }, [wsId, scope, t, startPolling]);

  // ── Raw client-side export ─────────────────────────────────
  const handleRawExport = useCallback(async (
    severities: string[],
    tools: string[],
    statuses: string[],
    format: ExportFormat,
  ) => {
    if (!wsId) return;
    setOpen(false);
    // Reuse the AI job state machine so the button shows progress and stays
    // disabled while the (potentially long) paged fetch runs.
    setAiJob({ phase: 'processing', jobId: '', raw: true });

    try {
      // Fetch ALL findings for the scope+filter in pages.
      const allFindings: Finding[] = [];
      let offset = 0;
      const limit = 500;
      while (true) {
        const params = new URLSearchParams({
          workspace_id: String(wsId),
          status: statuses.join(','),
          severity: severities.join(','),
          tool: tools.join(','),
          limit: String(limit),
          offset: String(offset),
          sort: 'severity',
          dir: 'asc',
          include_secrets: 'true',
        });
        if (scope.type === 'repo' && scope.repositoryId !== undefined) {
          params.set('repository_id', String(scope.repositoryId));
        }
        const res = await apiFetch(`/api/findings?${params}`);
        if (!res.ok) {
          // Never silently deliver a truncated export.
          throw new Error(`findings page fetch failed (HTTP ${res.status})`);
        }
        const page = await res.json() as { count: number; results: Finding[] };
        allFindings.push(...page.results);
        // An empty page guarantees termination even if `count` overshoots.
        if (page.results.length === 0) break;
        if (allFindings.length >= page.count) break;
        offset += limit;
      }

      const isCsv = format === 'csv';
      const ext = isCsv ? 'csv' : 'md';
      const date = new Date().toISOString().slice(0, 10);

      // For repo scope: single file. For workspace: group by repo, zip if multiple.
      if (scope.type === 'repo') {
        const name = scope.repositoryName ?? 'repo';
        const content = isCsv
          ? generateFindingsCsv(allFindings as ExportFinding[])
          : generateFindingsMarkdown(name, allFindings as ExportFinding[]);
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
        downloadBlob(`${safeName}-findings-${date}.${ext}`, new Blob([content], { type: isCsv ? 'text/csv' : 'text/markdown' }));
      } else {
        // Workspace scope: group findings by repositoryName.
        const groups = new Map<string, Finding[]>();
        for (const f of allFindings) {
          const key = f.repositoryName ?? 'unknown';
          const arr = groups.get(key) ?? [];
          arr.push(f);
          groups.set(key, arr);
        }
        if (groups.size <= 1) {
          const [name = 'workspace', findings = []] = groups.size === 1
            ? Array.from(groups.entries())[0]
            : ['workspace' as string, [] as Finding[]];
          const content = isCsv
            ? generateFindingsCsv(findings as ExportFinding[])
            : generateFindingsMarkdown(name, findings as ExportFinding[]);
          const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
          downloadBlob(`${safeName}-findings-${date}.${ext}`, new Blob([content], { type: isCsv ? 'text/csv' : 'text/markdown' }));
        } else {
          // Multi-repo workspace export → zip
          const files = Array.from(groups.entries()).map(([repoName, findings]) => {
            const content = isCsv
              ? generateFindingsCsv(findings as ExportFinding[])
              : generateFindingsMarkdown(repoName, findings as ExportFinding[]);
            const safeName = repoName.replace(/[^a-zA-Z0-9._-]/g, '_');
            return { name: `${safeName}-findings.${ext}`, content };
          });
          await downloadAsZip(files, `findings-export-${date}.zip`);
        }
      }
      setAiJob({ phase: 'idle' });
    } catch {
      setAiJob({ phase: 'error', message: t('export.failed', 'Export failed') });
    }
  }, [wsId, scope, t]);

  const isProcessing = aiJob.phase === 'processing';

  return (
    <>
      <button
        type="button"
        className={cn('beast-btn-brief', isProcessing && 'beast-btn-brief-processing')}
        onClick={() => setOpen(true)}
        disabled={!wsId || isProcessing}
      >
        {isProcessing && <span className="beast-brief-spinner" />}
        {aiJob.phase === 'processing'
          ? (aiJob.raw
              ? t('export.preparing', 'Preparing export…')
              : t('export.processing', 'Processing…'))
          : (label ?? t('export.button', 'Export'))}
      </button>
      {aiJob.phase === 'error' && (
        <span className="beast-brief-error">
          {aiJob.message}
          <button
            type="button"
            className="beast-chip-remove"
            onClick={() => setAiJob({ phase: 'idle' })}
            aria-label={t('common.dismiss', 'Dismiss')}
            title={t('common.dismiss', 'Dismiss')}
          >
            &times;
          </button>
        </span>
      )}

      <ExportDialog
        open={open}
        repoCount={scope.type === 'repo' ? 1 : 0}
        toolCounts={toolCounts}
        onCancel={() => setOpen(false)}
        onExport={handleRawExport}
        onAiExport={handleAiExport}
      />
    </>
  );
}
