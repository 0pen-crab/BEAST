import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFinding, useUpdateFinding, useFindingNotes, useAddFindingNote } from '@/api/hooks';
import { SeverityBadge } from '@/components/severity-badge';
import { StatusBadge } from '@/components/status-badge';
import { MarkdownContent } from '@/components/markdown-content';
import { CardSkeleton } from '@/components/skeleton';
import { ErrorBoundary } from '@/components/error-boundary';
import { formatDate, formatDateTime } from '@/lib/format';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { getToolIcon } from '@/lib/tool-icons';

type StatusAction = 'open' | 'false_positive' | 'fixed' | 'risk_accepted' | 'duplicate';
const statusActions: { key: StatusAction; label: string }[] = [
  { key: 'open', label: 'status.Open' },
  { key: 'false_positive', label: 'status.FalsePositive' },
  { key: 'fixed', label: 'status.Fixed' },
  { key: 'risk_accepted', label: 'status.Accepted' },
  { key: 'duplicate', label: 'status.Duplicate' },
];

function getStatusPayload(action: StatusAction) {
  return { status: action };
}

export function FindingDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const findingId = Number(id);
  const { data: finding, isLoading } = useFinding(findingId);
  const { data: notes } = useFindingNotes(findingId);
  const updateFinding = useUpdateFinding();
  const addNote = useAddFindingNote();
  const [noteText, setNoteText] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleStatusChange(action: StatusAction) {
    updateFinding.mutate({ id: findingId, ...getStatusPayload(action) });
  }

  function handleAddNote() {
    if (!noteText.trim()) return;
    addNote.mutate({ findingId, entry: noteText }, { onSuccess: () => setNoteText('') });
  }

  if (isLoading) {
    return (
      <div className="beast-stack">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!finding) {
    return <p className="beast-empty">{t('findings.detail.notFound')}</p>;
  }

  const notesList = notes && Array.isArray(notes) ? notes : [];

  // Breadcrumb items
  const breadcrumbItems = finding.repositoryName && finding.repositoryId
    ? [
        { label: t('findings.title'), to: '/findings' },
        { label: `${finding.repositoryName} findings`, to: `/findings?repository=${finding.repositoryId}` },
        { label: `#${finding.id}` },
      ]
    : [
        { label: t('findings.title'), to: '/findings' },
        { label: `#${finding.id}` },
      ];

  return (
    <ErrorBoundary>
      <div className="beast-stack-md">
        <BreadcrumbNav items={breadcrumbItems} />

        {/* ── Header ── */}
        <div className="beast-page-header">
          <div>
            <h1 className="beast-finding-title">{finding.title}</h1>
            <div className="beast-finding-meta">
              {getToolIcon(finding.tool) && (
                <img src={getToolIcon(finding.tool)} alt="" className="beast-tool-row-icon" />
              )}
              <span>{finding.tool}</span>
              {finding.repositoryName && finding.repositoryId && (
                <>
                  <span className="beast-meta-sep" aria-hidden="true">&middot;</span>
                  <Link to={`/repos/${finding.repositoryId}`} className="beast-link">{finding.repositoryName}</Link>
                </>
              )}
              {finding.contributorId && finding.contributorName && (
                <>
                  <span className="beast-meta-sep" aria-hidden="true">&middot;</span>
                  <Link to={`/contributors/${finding.contributorId}`} className="beast-link">{finding.contributorName}</Link>
                </>
              )}
              <span className="beast-meta-sep" aria-hidden="true">&middot;</span>
              <span>{formatDate(finding.createdAt)}</span>
            </div>
            {(finding.cwe != null || finding.cvssScore != null) && (
              <div className="beast-finding-badges">
                {finding.cwe != null && (
                  <a
                    href={`https://cwe.mitre.org/data/definitions/${finding.cwe}.html`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="beast-badge beast-badge-red"
                  >
                    CWE-{finding.cwe}
                  </a>
                )}
                {finding.cvssScore != null && (
                  <span className="beast-badge beast-badge-gray">
                    {t('findings.cvss')} {finding.cvssScore}
                  </span>
                )}
              </div>
            )}
          </div>
          <SeverityBadge severity={finding.severity} size="lg" />
        </div>

        {/* ── Two-column body ── */}
        <div className="beast-grid-detail">
          {/* Left: description + location + notes */}
          <div className="beast-stack-md">
            {/* Description & Location card */}
            <div className="beast-card beast-card-flush beast-overflow-hidden">
              <div className="beast-section-header">
                <span className="beast-label beast-label-inline">{t('findings.detail.description')}</span>
              </div>
              <div className="beast-section-pad-sm">
                {finding.description
                  ? <MarkdownContent content={finding.description} />
                  : <p className="beast-page-subtitle">{t('findings.detail.noDescription')}</p>
                }
              </div>
              {finding.filePath && (
                <>
                  <div className="beast-section-header">
                    <span className="beast-label beast-label-inline">{t('findings.detail.location')}</span>
                  </div>
                  <div className="beast-section-pad-sm">
                    <code className="beast-td-code">{finding.filePath}{finding.line != null ? `:${finding.line}` : ''}</code>
                    {finding.codeSnippet && (
                      <pre className="beast-code-snippet">{finding.codeSnippet}</pre>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Notes card */}
            <div className="beast-card beast-card-flush beast-overflow-hidden">
              <div className="beast-section-header">
                <span className="beast-label beast-label-inline">{t('findings.detail.notes')} ({notesList.length})</span>
              </div>
              <div className="beast-section-pad-sm">
                {notesList.length > 0 && (
                  <div className="beast-stack-sm">
                    {notesList.map((note) => (
                      <div key={note.id} className="beast-note-card">
                        <div className="beast-note-header">
                          <span className="beast-label beast-label-inline">{note.author}</span>
                          <span className="beast-page-subtitle">{formatDateTime(note.createdAt)}</span>
                        </div>
                        <p className="beast-note-body">{note.content}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="beast-note-input-row">
                  <input
                    type="text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                    placeholder={t('findings.detail.addNotePlaceholder')}
                    className="beast-input beast-input-sm beast-flex-1"
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={!noteText.trim() || addNote.isPending}
                    className="beast-btn beast-btn-primary beast-btn-sm"
                  >
                    {t('findings.detail.addNote')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: properties sidebar */}
          <div className="beast-card beast-card-flush beast-overflow-hidden">
            <div className="beast-section-header">
              <span className="beast-label beast-label-inline">{t('findings.detail.properties')}</span>
            </div>
            <div className="beast-props">
              <span
                className="beast-prop-key beast-prop-clickable"
                onClick={() => setStatusOpen(!statusOpen)}
              >
                {t('findings.status')}
              </span>
              <div className="beast-prop-val beast-prop-clickable beast-prop-status-cell" ref={statusRef}>
                <button className="beast-status-clickable" onClick={() => setStatusOpen(!statusOpen)}>
                  <StatusBadge finding={finding} />
                  <span className="beast-chevron">{statusOpen ? '▲' : '▼'}</span>
                </button>
                {statusOpen && (
                  <div className="beast-filter-dropdown beast-status-dropdown">
                    {statusActions
                      .filter((action) => action.key !== finding.status)
                      .map((action) => (
                        <button
                          key={action.key}
                          className="beast-filter-dropdown-item"
                          disabled={updateFinding.isPending}
                          onClick={() => {
                            handleStatusChange(action.key);
                            setStatusOpen(false);
                          }}
                        >
                          {t(action.label)}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              <span className="beast-prop-key">{t('findings.severity')}</span>
              <span className="beast-prop-val"><SeverityBadge severity={finding.severity} /></span>

              <span className="beast-prop-key">{t('findings.tool')}</span>
              <span className="beast-prop-val beast-flex beast-flex-gap-sm">
                {getToolIcon(finding.tool) && (
                  <img src={getToolIcon(finding.tool)} alt="" className="beast-tool-row-icon" />
                )}
                {finding.tool}
              </span>

              {finding.cwe != null && (
                <>
                  <span className="beast-prop-key">CWE</span>
                  <span className="beast-prop-val">
                    <a href={`https://cwe.mitre.org/data/definitions/${finding.cwe}.html`} target="_blank" rel="noopener noreferrer" className="beast-link-red">
                      CWE-{finding.cwe}
                    </a>
                  </span>
                </>
              )}

              {finding.cvssScore != null && (
                <>
                  <span className="beast-prop-key">{t('findings.cvss')}</span>
                  <span className="beast-prop-val">{finding.cvssScore}</span>
                </>
              )}

              {finding.vulnIdFromTool && (
                <>
                  <span className="beast-prop-key">{t('findings.detail.vulnId')}</span>
                  <span className="beast-prop-val beast-td-code beast-break-all">{finding.vulnIdFromTool}</span>
                </>
              )}

              {finding.repositoryName && finding.repositoryId && (
                <>
                  <span className="beast-prop-key">{t('findings.repository')}</span>
                  <span className="beast-prop-val">
                    <Link to={`/repos/${finding.repositoryId}`} className="beast-link">{finding.repositoryName}</Link>
                  </span>
                </>
              )}

              {finding.contributorId && finding.contributorName && (
                <>
                  <span className="beast-prop-key">{t('findings.contributor')}</span>
                  <span className="beast-prop-val">
                    <Link to={`/contributors/${finding.contributorId}`} className="beast-link">{finding.contributorName}</Link>
                  </span>
                </>
              )}

              <span className="beast-prop-key">{t('findings.detail.found')}</span>
              <span className="beast-prop-val">{formatDate(finding.createdAt)}</span>
            </div>
          </div>
        </div>

      </div>
    </ErrorBoundary>
  );
}
