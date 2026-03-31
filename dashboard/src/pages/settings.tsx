import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { useWorkspace, type Workspace } from '@/lib/workspace';
import { useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/lib/format';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  useSources,
  useSourceRepos,
  useSyncSource,
  useDeleteSource,
  useToolRegistry,
  useWorkspaceTools,
  useUpdateWorkspaceTools,
  useValidateToken,
  useDisconnectTool,
} from '@/api/hooks';
import { apiFetch } from '@/api/client';
import { SourceForm } from '@/components/sources/source-form';
import { CompactToolCard } from '@/components/compact-tool-card';
import { IntegrationPanel, type IntegrationStatus } from '@/components/integration-panel';
import { buildIntegrationGroups } from '@/lib/integration-groups';
import { PROVIDER_DISPLAY } from '@/lib/provider-display';
import { ProviderIcon } from '@/lib/provider-icons';
import type { Source, DiscoveredRepo, ToolDefinition } from '@/api/types';
import { RepoPicker } from '@/components/sources/repo-picker';
import { LanguageSelect } from '@/components/language-select';
import { useAuth } from '@/lib/auth';
import { useCurrentWorkspaceRole, canWrite } from '@/lib/permissions';

export function SettingsPage() {
  const { t } = useTranslation();
  const { currentWorkspace, refetchWorkspaces } = useWorkspace();
  const { user } = useAuth();
  const wsRole = useCurrentWorkspaceRole();
  const canEdit = user ? canWrite(user.role, wsRole ?? undefined) : false;
  const location = useLocation();
  const sourcesRef = useRef<HTMLDivElement>(null);
  const [highlightSources, setHighlightSources] = useState(false);

  useEffect(() => {
    if (location.hash === '#sources') {
      const raf = requestAnimationFrame(() => {
        sourcesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setHighlightSources(true);
      });
      const timer = setTimeout(() => setHighlightSources(false), 2000);
      return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
    }
  }, [location.hash]);

  if (!currentWorkspace) return null;

  return (
    <ErrorBoundary>
      <div className="settings-main space-y-6">
        <div>
          <h1 className="beast-page-title">{t('settings.title')}</h1>
          <p className="beast-page-subtitle">
            {t('settings.subtitle')}
          </p>
        </div>

        <EditSection
          workspace={currentWorkspace}
          onUpdated={refetchWorkspaces}
          readOnly={!canEdit}
        />

        {canEdit && (
          <div ref={sourcesRef} id="sources" className={highlightSources ? 'beast-highlight-pulse' : ''}>
            <SourcesSection workspaceId={currentWorkspace.id} />
          </div>
        )}

        {canEdit && <SecurityToolsSection workspaceId={currentWorkspace.id} />}

        {canEdit && (
          <DangerZone
            workspace={currentWorkspace}
            onDeleted={async () => {
              await refetchWorkspaces();
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}


function EditSection({
  workspace,
  onUpdated,
  readOnly = false,
}: {
  workspace: Workspace;
  onUpdated: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');
  const [defaultLanguage, setDefaultLanguage] = useState(workspace.defaultLanguage || 'en');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Reset form when workspace changes
  const [prevId, setPrevId] = useState(workspace.id);
  if (workspace.id !== prevId) {
    setPrevId(workspace.id);
    setName(workspace.name);
    setDescription(workspace.description ?? '');
    setDefaultLanguage(workspace.defaultLanguage || 'en');
    setSuccess(false);
    setError('');
  }

  const dirty =
    name.trim() !== workspace.name ||
    (description.trim() || '') !== (workspace.description || '') ||
    defaultLanguage !== (workspace.defaultLanguage || 'en');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          default_language: defaultLanguage,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch((err) => {
          console.error('[settings] Failed to parse error response:', err);
          return {};
        });
        throw new Error(data.message || 'Failed to update workspace');
      }
      onUpdated();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="beast-card">
      <h2 className="beast-card-title">{t('settings.general')}</h2>
      <div className="beast-card-subtitle" />
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="beast-error">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="ws-name" className="beast-label">
            {t('settings.workspaceName')}
          </label>
          <input
            id="ws-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={readOnly}
            className="beast-input"
          />
        </div>

        <div>
          <label htmlFor="ws-desc" className="beast-label">
            {t('settings.description')}{' '}
            <span className="beast-toggle-text">({t('common.optional')})</span>
          </label>
          <input
            id="ws-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly}
            className="beast-input"
            placeholder={t('settings.descPlaceholder')}
          />
        </div>

        <div>
          <label className="beast-label">
            {t('workspace.defaultLanguage')}
          </label>
          <p className="beast-text-hint">{t('workspace.defaultLanguageDesc')}</p>
          <LanguageSelect value={defaultLanguage} onChange={setDefaultLanguage} disabled={readOnly} />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={readOnly || !dirty || saving || !name.trim()}
            className="beast-btn beast-btn-primary"
          >
            {saving ? t('settings.saving') : t('settings.saveChanges')}
          </button>
          {success && (
            <span className="beast-success">{t('common.saved')}</span>
          )}
        </div>
      </form>
    </div>
  );
}

function SecurityToolsSection({ workspaceId }: { workspaceId: number }) {
  const { t } = useTranslation();
  const { data: registry = [] } = useToolRegistry();
  const { data: workspaceTools = [] } = useWorkspaceTools(workspaceId);
  const updateTools = useUpdateWorkspaceTools(workspaceId);
  const validateToken = useValidateToken(workspaceId);
  const disconnectTool = useDisconnectTool(workspaceId);

  // Build enabled state from workspace tools, falling back to recommended
  const enabledMap: Record<string, boolean> = {};
  for (const tool of registry) {
    const wt = workspaceTools.find(w => w.tool_key === tool.key);
    enabledMap[tool.key] = wt ? wt.enabled : tool.recommended;
  }

  // Build has_credentials map
  const credMap: Record<string, boolean> = {};
  for (const wt of workspaceTools) {
    credMap[wt.tool_key] = wt.has_credentials;
  }

  // Integration states — pre-populate from credMap
  const [integrationStates, setIntegrationStates] = useState<
    Record<string, { status: IntegrationStatus; error?: string }>
  >({});

  // Group tools by category
  const categories = ['secrets', 'sast', 'sca', 'iac'] as const;
  const grouped = categories.map(cat => ({
    category: cat,
    tools: registry.filter((tool: ToolDefinition) => tool.category === cat),
  })).filter(g => g.tools.length > 0);

  function handleToggle(key: string, enabled: boolean) {
    const tools = registry.map((tool: ToolDefinition) => ({
      tool_key: tool.key,
      enabled: tool.key === key ? enabled : enabledMap[tool.key],
    }));
    updateTools.mutate(tools);
  }

  function handleDisconnect(groupKey: string, toolKey: string) {
    disconnectTool.mutate(toolKey, {
      onSuccess: () => {
        setIntegrationStates((prev) => ({ ...prev, [groupKey]: { status: 'pending' } }));
      },
    });
  }

  function handleValidate(groupKey: string, toolKey: string, credentials: Record<string, string>) {
    setIntegrationStates((prev) => ({ ...prev, [groupKey]: { status: 'validating' } }));

    validateToken.mutate(
      { tool_key: toolKey, credentials },
      {
        onSuccess: () => {
          setIntegrationStates((prev) => ({ ...prev, [groupKey]: { status: 'connected' } }));
          // Ensure tool selections exist in DB and persist credentials
          const tools = registry.map((tool: ToolDefinition) => ({
            tool_key: tool.key,
            enabled: enabledMap[tool.key],
            ...(tool.key === toolKey ? { credentials } : {}),
          }));
          updateTools.mutate(tools);
        },
        onError: (err: any) => {
          let errorMsg = 'Validation failed';
          try {
            const parsed = JSON.parse(err.message);
            errorMsg = parsed.error ?? errorMsg;
          } catch {
            errorMsg = err.message ?? errorMsg;
          }
          setIntegrationStates((prev) => ({
            ...prev,
            [groupKey]: { status: 'error', error: errorMsg },
          }));
        },
      },
    );
  }

  // Build integration groups from enabled tools
  const integrationGroups = buildIntegrationGroups(registry, enabledMap);

  // Resolve effective status: if credMap says tool has credentials, treat as connected
  function getEffectiveStatus(groupKey: string): IntegrationStatus {
    if (integrationStates[groupKey]) return integrationStates[groupKey].status;
    // Check if any tool in this group already has credentials
    const group = integrationGroups.find(g => g.groupKey === groupKey);
    if (group) {
      const toolKey = group.validatorToolKey;
      if (credMap[toolKey]) return 'connected';
    }
    return 'pending';
  }

  return (
    <div className="settings-tools-row">
      <div className="beast-card">
        <h2 className="beast-card-title">
          {t('settings.securityTools')}
        </h2>
        <p className="beast-card-subtitle">
          {t('settings.securityToolsSubtitle')}
        </p>

        {grouped.map(({ category, tools }) => (
          <div key={category} className="mb-6">
            <h3 className="beast-category-header">
              {t(`tools.categories.${category}`)}
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              {tools.map((tool: ToolDefinition) => (
                <CompactToolCard
                  key={tool.key}
                  tool={tool}
                  enabled={enabledMap[tool.key]}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden xl:block">
        <div className="beast-card sticky top-6">
          <h3 className="beast-card-title">{t('onboarding.integrations')}</h3>

          {integrationGroups.length === 0 ? (
            <p className="beast-page-subtitle">{t('onboarding.noIntegrations')}</p>
          ) : (
            <div className="space-y-2.5">
              {integrationGroups.map((group) => (
                <IntegrationPanel
                  key={group.groupKey}
                  name={group.name}
                  iconLetter={group.iconLetter}
                  iconColor={group.iconColor}
                  iconUrl={group.iconUrl}
                  credentials={group.credentials}
                  usedBy={group.usedBy}
                  status={getEffectiveStatus(group.groupKey)}
                  error={integrationStates[group.groupKey]?.error}
                  onValidate={(creds) => handleValidate(group.groupKey, group.validatorToolKey, creds)}
                  onDisconnect={() => handleDisconnect(group.groupKey, group.validatorToolKey)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SourcesSection({ workspaceId }: { workspaceId: number }) {
  const { t } = useTranslation();
  const { data: sources, isLoading } = useSources();
  const syncMutation = useSyncSource();
  const deleteMutation = useDeleteSource();

  const [showForm, setShowForm] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<number>>(new Set());

  function handleConnected() {
    setShowForm(false);
  }

  function toggleExpand(id: number) {
    setExpandedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSync(id: number) {
    setSyncingId(id);
    syncMutation.mutate(id, {
      onSettled: () => setSyncingId(null),
    });
  }

  function handleDelete(id: number) {
    deleteMutation.mutate(id);
  }

  function formatLastSynced(dateStr: string | null) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return formatDate(d);
  }

  return (
    <div className="beast-card">
      <div className="flex items-center justify-between mb-1">
        <h2 className="beast-card-title">
          {t('sources.title')}
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="beast-btn beast-btn-primary beast-btn-sm"
          >
            {t('sources.addSource')}
          </button>
        )}
      </div>
      <p className="beast-card-subtitle">
        {t('sources.subtitle')}
      </p>

      {/* Add source form */}
      {showForm && (
        <div className="beast-source-form-wrap">
          <SourceForm
            workspaceId={workspaceId}
            onConnected={handleConnected}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Source list */}
      {isLoading ? (
        <p className="beast-page-subtitle">{t('common.loading')}</p>
      ) : !sources || sources.length === 0 ? (
        <div className="beast-empty">
          <p className="beast-empty-title">{t('sources.noSources')}</p>
          <p className="beast-empty-desc">{t('sources.noSourcesDesc')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((src) => (
            <SourceCard
              key={src.id}
              source={src}
              expanded={expandedSourceIds.has(src.id)}
              onToggleExpand={() => toggleExpand(src.id)}
              syncing={syncingId === src.id}
              onSync={() => handleSync(src.id)}
              onDelete={() => handleDelete(src.id)}
              deleteDisabled={deleteMutation.isPending}
              formatLastSynced={formatLastSynced}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceCard({
  source,
  expanded,
  onToggleExpand,
  syncing,
  onSync,
  onDelete,
  deleteDisabled,
  formatLastSynced,
}: {
  source: Source;
  expanded: boolean;
  onToggleExpand: () => void;
  syncing: boolean;
  onSync: () => void;
  onDelete: () => void;
  deleteDisabled: boolean;
  formatLastSynced: (dateStr: string | null) => string;
}) {
  const { t } = useTranslation();
  const { data: repos = [] } = useSourceRepos(source.id);

  const display = PROVIDER_DISPLAY[source.provider] ?? { label: source.provider, color: 'text-th-text-secondary' };
  const repoCount = repos.length;

  return (
    <div className="beast-source-card">
      {/* Header row */}
      <div
        className="beast-source-header"
        onClick={onToggleExpand}
      >
        <ProviderIcon
          provider={source.provider}
          className="h-5 w-5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('beast-source-name', display.color)}>
              {display.label}
            </span>
            {source.orgName && (
              <span className="beast-source-org">
                {source.orgName}
              </span>
            )}
            {repoCount > 0 && (
              <span className="beast-source-meta">
                {repoCount} repos
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="beast-source-detail">
              {t('sources.lastSynced')}: {formatLastSynced(source.lastSyncedAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onSync}
            disabled={syncing}
            className="beast-btn beast-btn-outline beast-btn-sm"
          >
            {syncing ? t('sources.syncing') : t('sources.syncNow')}
          </button>
          <button
            onClick={onDelete}
            disabled={deleteDisabled}
            className="beast-btn beast-btn-danger beast-btn-sm"
          >
            {t('sources.remove')}
          </button>
        </div>
        {/* Chevron */}
        <svg
          className={cn(
            'h-4 w-4 shrink-0 beast-chevron',
            expanded && 'beast-chevron-open',
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded: RepoPicker */}
      {expanded && (
        <div className="beast-source-expand">
          <RepoPicker
            repos={repos}
            sourceId={source.id}
            onImported={() => {}}
          />
        </div>
      )}
    </div>
  );
}

function DangerZone({
  workspace,
  onDeleted,
}: {
  workspace: Workspace;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // Reset confirm state when workspace changes
  const [prevId, setPrevId] = useState(workspace.id);
  if (workspace.id !== prevId) {
    setPrevId(workspace.id);
    setConfirming(false);
    setConfirmText('');
    setError('');
  }

  async function handleDelete() {
    if (confirmText !== workspace.name || deleting) return;
    setDeleting(true);
    setError('');
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch((err) => {
          console.error('[settings] Failed to parse error response:', err);
          return {};
        });
        throw new Error(data.message || 'Failed to delete workspace');
      }
      qc.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'workspaces',
      });
      onDeleted();
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to delete');
      setDeleting(false);
    }
  }

  return (
    <div className="beast-card beast-card-danger">
      <h2 className="beast-card-title beast-card-title-danger">
        {t('settings.dangerZone')}
      </h2>
      <p className="beast-card-subtitle">
        {t('settings.dangerDesc')}
      </p>

      {error && (
        <div className="beast-error beast-mb-md">
          {error}
        </div>
      )}

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="beast-btn beast-btn-danger"
        >
          {t('settings.deleteWorkspace')}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="beast-text-confirm">
            {t('settings.typeToConfirm')} <span className="beast-text-mono-red">{workspace.name}</span> {t('settings.toConfirm')}
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
            className="beast-input"
            placeholder={workspace.name}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={confirmText !== workspace.name || deleting}
              className="beast-btn beast-btn-primary"
            >
              {deleting ? t('settings.deleting') : t('settings.permanentlyDelete')}
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                setConfirmText('');
              }}
              className="beast-btn beast-btn-outline"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
