import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useRepository, useRepositoryTests, useFindingCounts, useFindings, useDeleteRepository, useRepoReports, useScanArtifacts, useTriggerScan, useSource } from '@/api/hooks';
import { ProviderIcon } from '@/lib/provider-icons';
import { SeverityBadge } from '@/components/severity-badge';
import { StatusBadge } from '@/components/status-badge';
import { CardSkeleton, Skeleton, TableSkeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { ErrorBoundary } from '@/components/error-boundary';
import { MarkdownContent } from '@/components/markdown-content';
import { TOOL_CATEGORIES, resolveToolFromTest, getToolsByCategory, type ToolInfo } from '@/lib/tool-mapping';
import { getToolIcon } from '@/lib/tool-icons';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/api/client';
import { formatDate, formatDateShort } from '@/lib/format';
import type { Test, Severity } from '@/api/types';

async function downloadArtifact(repoId: number, toolKey: string, fileName: string) {
  const res = await apiFetch(`/api/scan-artifacts/${repoId}/${toolKey}/download`);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}


const STATUS_CLASS: Record<string, string> = {
  pending: 'status-queued',
  queued: 'status-queued',
  analyzing: 'status-running',
  completed: 'status-completed',
  failed: 'status-failed',
  ignored: 'status-queued',
};

function RepoStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const label = t(`repos.status${status.charAt(0).toUpperCase() + status.slice(1)}`);
  return (
    <span className={cn(
      'status-pill beast-badge-sm',
      STATUS_CLASS[status] ?? 'status-queued',
      status === 'analyzing' && 'beast-animate-pulse',
    )}>
      {label}
    </span>
  );
}

export function RepoPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const productId = Number(id);
  const { data: repo } = useRepository(productId);
  const { data: allTests, isLoading } = useRepositoryTests(productId);
  const { data: counts } = useFindingCounts({ repositoryId: productId });
  const { data: artifactsData } = useScanArtifacts(productId);
  const { data: source } = useSource(repo?.sourceId ?? 0);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteRepository = useDeleteRepository();
  const triggerScan = useTriggerScan();

  // Group tests by tool
  const toolTests = new Map<string, Test[]>();
  allTests?.forEach((test) => {
    const tool = resolveToolFromTest(test.tool);
    if (tool) {
      const existing = toolTests.get(tool.key) ?? [];
      existing.push(test);
      toolTests.set(tool.key, existing);
    }
  });

  const handleDelete = () => {
    deleteRepository.mutate(productId, {
      onSuccess: () => navigate('/teams'),
    });
  };

  return (
    <ErrorBoundary>
      <div className="beast-stack">
        <BreadcrumbNav items={[{ label: t('nav.repos'), to: '/repos' }, { label: repo?.name ?? '...' }]} />
        {/* Header */}
        <div className="beast-page-header">
          <div>
            <div className="beast-flex beast-flex-gap-sm">
              <h1 className="beast-page-title">{repo?.name}</h1>
              {repo?.status && <RepoStatusBadge status={repo.status} />}
            </div>
            {source && (
              <div className="beast-flex beast-flex-gap-sm beast-page-subtitle">
                <ProviderIcon provider={source.provider} className="beast-icon-sm" />
                <span>{source.orgName ?? source.provider}</span>
              </div>
            )}
            {repo?.description && <p className="beast-page-subtitle">{repo.description}</p>}
            {repo?.tags && repo.tags.length > 0 && (
              <div className="beast-tag-row">
                {repo.tags.map((t) => (
                  <span key={t} className="beast-badge beast-badge-gray">{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="beast-flex beast-flex-gap-sm">
            <button
              onClick={() => triggerScan.mutate({ repositoryId: productId })}
              disabled={triggerScan.isPending || repo?.status === 'analyzing'}
              className="beast-btn beast-btn-primary beast-btn-sm"
            >
              {triggerScan.isPending ? '...' : t('repos.scan')}
            </button>
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="beast-btn beast-btn-danger beast-btn-sm"
            >
              {t('common.delete')}
            </button>
          </div>
        </div>

        {/* Delete confirmation */}
        {showDeleteDialog && (
          <div className="beast-overlay" onClick={() => setShowDeleteDialog(false)}>
            <div className="beast-modal beast-modal-sm" onClick={(e) => e.stopPropagation()}>
              <h3 className="beast-modal-title">{t('repo.deleteRepo')}</h3>
              <p className="beast-modal-body">
                {t('repo.deleteRepoConfirm')} <strong>{repo?.name}</strong>{t('repo.deleteRepoWarning')}
              </p>
              <div className="beast-modal-actions">
                <button
                  onClick={() => setShowDeleteDialog(false)}
                  className="beast-btn beast-btn-outline beast-btn-sm"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteRepository.isPending}
                  className="beast-btn beast-btn-danger beast-btn-sm"
                >
                  {deleteRepository.isPending ? t('settings.deleting') : t('common.delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Summary stats */}
        {counts && (
          <div className="beast-grid-6">
            {(['Critical', 'High', 'Medium', 'Low', 'Info'] as Severity[]).map((sev) => (
              <div key={sev} className={`beast-metric beast-metric-${sev.toLowerCase()}`}>
                <p className="beast-metric-label">{sev}</p>
                <p className="beast-metric-value beast-metric-value-sm">{counts[sev]}</p>
              </div>
            ))}
            <div className="beast-metric beast-metric-accepted">
              <p className="beast-metric-label">{t('repo.triagedByAi')}</p>
              <p className="beast-metric-value beast-metric-value-sm beast-score-good-text">{counts.riskAccepted}</p>
            </div>
          </div>
        )}

            {/* Reports (Profile + Audit) */}
            <RepoReports repositoryId={productId} />

            {/* Tool cards by category */}
            <div className="beast-stack-md">
              <h2 className="beast-card-title">{t('repo.scanResultsByTool')}</h2>
              {isLoading ? (
                <div className="beast-grid-2">
                  {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
                </div>
              ) : (
                <div className="beast-grid-2">
                  {TOOL_CATEGORIES.map((cat) => {
                    const catTools = getToolsByCategory(cat.key);
                    return (
                      <CategoryCard
                        key={cat.key}
                        category={cat}
                        tools={catTools}
                        toolTests={toolTests}
                        productId={productId}
                        artifactsData={artifactsData}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* All findings for this repo */}
            <RepoFindings productId={productId} />
      </div>
    </ErrorBoundary>
  );
}

function CategoryCard({
  category,
  tools,
  toolTests,
  productId,
  artifactsData,
}: {
  category: import('@/lib/tool-mapping').CategoryInfo;
  tools: ToolInfo[];
  toolTests: Map<string, Test[]>;
  productId: number;
  artifactsData: { artifacts: { tool: string; fileName: string }[] } | undefined;
}) {
  const { t } = useTranslation();

  const toolsWithData = tools.filter((tool) => (toolTests.get(tool.key) ?? []).length > 0);
  const hasData = toolsWithData.length > 0;

  const totalFindings = toolsWithData.reduce((sum, tool) => {
    const tests = toolTests.get(tool.key) ?? [];
    return sum + (tests[0]?.findingsCount ?? 0);
  }, 0);

  return (
    <div className={cn(
      'beast-card beast-card-flush',
      hasData ? `beast-cat-card-border-${category.key}` : 'beast-cat-card-empty',
    )}>
      <div className="beast-card-section">
        <div className="beast-flex-between">
          <div className="beast-flex beast-flex-gap">
            <span className={cn('beast-tool-icon', `beast-tool-icon-${category.key}`)}>
              {category.icon}
            </span>
            <div>
              <p className={cn(
                'beast-label',
                hasData ? `beast-cat-text-${category.key}` : 'beast-text-muted',
              )}>
                {category.displayName}
              </p>
              <p className="beast-page-subtitle">{category.description}</p>
            </div>
          </div>
          {hasData && (
            <span className="beast-cat-total">{totalFindings}</span>
          )}
        </div>

        {hasData ? (
          <div className="beast-tool-list">
            {toolsWithData.map((tool) => {
              const tests = toolTests.get(tool.key) ?? [];
              const latestTest = tests[0];
              const artifact = artifactsData?.artifacts?.find(a => a.tool === tool.key);
              const icon = getToolIcon(tool.key);
              return (
                <div key={tool.key} className="beast-tool-row">
                  <div className="beast-tool-row-left">
                    {icon
                      ? <img src={icon} alt="" className="beast-tool-row-icon" />
                      : <span className={cn('beast-severity-dot', tool.bgClass)} />
                    }
                    <Link to={`/findings?tool=${tool.key}`} className="beast-link-red beast-label">
                      {tool.displayName}
                    </Link>
                  </div>
                  <div className="beast-tool-row-right">
                    <span className="beast-tool-row-count">{latestTest?.findingsCount ?? 0}</span>
                    <span className="beast-tool-row-date">{formatDate(latestTest.createdAt)}</span>
                    {artifact ? (
                      <button
                        className="beast-tool-row-dl"
                        title={artifact.fileName}
                        onClick={() => downloadArtifact(productId, tool.key, artifact.fileName)}
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v9M4 8l4 4 4-4M2 14h12" /></svg>
                      </button>
                    ) : (
                      <span className="beast-tool-row-dl-placeholder" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="beast-page-subtitle beast-tool-list">{t('repo.noScanData')}</p>
        )}
      </div>
    </div>
  );
}

const TOP_FINDINGS_LIMIT = 10;

function RepoFindings({ productId }: { productId: number }) {
  const { t } = useTranslation();

  const { data: findings, isLoading } = useFindings({
    limit: TOP_FINDINGS_LIMIT,
    offset: 0,
    duplicate: false,
    sort: 'severity',
    dir: 'desc',
    repository_id: productId,
  });

  const hasMore = findings && findings.count > TOP_FINDINGS_LIMIT;

  return (
    <>
    <div className="beast-card beast-card-flush">
      <div className="beast-card-header">
        <h2 className="beast-card-title">{t('repo.topFindings')}</h2>
        {hasMore && (
          <Link to={`/findings?repository=${productId}`} className="beast-btn beast-btn-sm beast-btn-primary">{t('common.viewAll')}</Link>
        )}
      </div>
      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : !findings?.results.length ? (
        <p className="beast-empty">{t('repo.noFindings')}</p>
      ) : (
        <>
          <table className="beast-table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('findings.severity')}</th>
                <th>{t('findings.tool')}</th>
                <th>{t('findings.contributor')}</th>
                <th>{t('findings.status')}</th>
                <th className="beast-th-right">{t('repo.date')}</th>
              </tr>
            </thead>
            <tbody>
              {findings.results.map((finding) => {
                const toolMeta = resolveToolFromTest(finding.tool);
                return (
                <tr key={finding.id} className={cn(finding.status !== 'open' && 'beast-row-dimmed')}>
                  <td>
                    <Link to={`/findings/${finding.id}`} className="beast-td-primary beast-row-link">
                      {finding.title}
                    </Link>
                  </td>
                  <td><SeverityBadge severity={finding.severity} /></td>
                  <td>{toolMeta?.displayName ?? finding.tool}</td>
                  <td>
                    {finding.contributorId ? (
                      <Link to={`/contributors/${finding.contributorId}`} className="beast-link">
                        {finding.contributorName}
                      </Link>
                    ) : finding.contributorName ?? '\u2014'}
                  </td>
                  <td><StatusBadge finding={finding} /></td>
                  <td className="beast-td-date">{formatDateShort(finding.createdAt)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
    {hasMore && (
      <div className="beast-flex-center">
        <Link to={`/findings?repository=${productId}`} className="beast-btn beast-btn-primary">{t('common.viewAll')}</Link>
      </div>
    )}
  </>
  );
}

function estimateReadingTime(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 220));
}

function ReportReader({ title, icon, content, updatedAt, onClose }: {
  title: string;
  icon: React.ReactNode;
  content: string;
  updatedAt: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="beast-reader-backdrop" onClick={onClose}>
      <div className="beast-reader-panel" onClick={(e) => e.stopPropagation()}>
        <div className="beast-reader-topbar">
          <div className="beast-reader-topbar-left">
            <div className="beast-reader-topbar-icon">{icon}</div>
            <span className="beast-reader-topbar-title">{title}</span>
            <span className="beast-reader-topbar-meta">
              {t('repo.generated')} {formatDate(updatedAt)} &middot; {estimateReadingTime(content)} min read
            </span>
          </div>
          <button className="beast-reader-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            ESC
          </button>
        </div>
        <div className="beast-reader-body">
          <div className="beast-reader-content">
            <MarkdownContent content={content} />
          </div>
        </div>
      </div>
    </div>
  );
}

const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 12h6M9 16h6M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9l-7-7z" />
    <path d="M13 2v7h7" />
  </svg>
);

const AuditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

function RepoReports({ repositoryId }: { repositoryId: number }) {
  const { t } = useTranslation();
  const { data: reports, isLoading } = useRepoReports(repositoryId);
  const [reader, setReader] = useState<'profile' | 'audit' | null>(null);

  const hasProfile = !!reports?.profile;
  const hasAudit = !!reports?.audit;
  const hasAny = hasProfile || hasAudit;

  if (isLoading) return <Skeleton className="beast-skeleton-block" />;
  if (!hasAny) return null;

  const cards = [
    {
      key: 'profile' as const,
      title: t('repo.repoProfile'),
      desc: t('repo.repoProfileDesc', 'Architecture, tech stack, contributors, code quality analysis'),
      icon: <ProfileIcon />,
      available: hasProfile,
    },
    {
      key: 'audit' as const,
      title: t('repo.securityAudit'),
      desc: t('repo.securityAuditDesc', 'Vulnerabilities, risk assessment, security boundaries, recommendations'),
      icon: <AuditIcon />,
      available: hasAudit,
    },
  ];

  const readerData = reader && reports?.[reader];

  return (
    <>
      <div className="beast-report-cards">
        {cards.map((card) => {
          const data = reports?.[card.key];
          return (
            <div
              key={card.key}
              className={cn('beast-report-card', !card.available && 'beast-report-card-disabled')}
              onClick={() => card.available && setReader(card.key)}
            >
              <div className="beast-report-card-top">
                <div className="beast-report-card-icon">{card.icon}</div>
                <div className="beast-report-card-text">
                  <div className="beast-report-card-title">{card.title}</div>
                  <div className="beast-report-card-desc">{card.desc}</div>
                </div>
              </div>
              {data && (
                <div className="beast-report-card-meta">
                  <span className="beast-report-card-meta-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                    {formatDate(data.updated_at)}
                  </span>
                  <span className="beast-report-card-meta-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                    {estimateReadingTime(data.content)} min read
                  </span>
                  <span className="beast-report-card-meta-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
                    {Math.ceil(data.content.trim().split(/\s+/).length / 100) * 100}+ words
                  </span>
                </div>
              )}
              <div className="beast-report-card-arrow"><ArrowIcon /></div>
            </div>
          );
        })}
      </div>
      {readerData && reader && createPortal(
        <ReportReader
          title={cards.find(c => c.key === reader)!.title}
          icon={cards.find(c => c.key === reader)!.icon}
          content={readerData.content}
          updatedAt={readerData.updated_at}
          onClose={() => setReader(null)}
        />,
        document.body,
      )}
    </>
  );
}
