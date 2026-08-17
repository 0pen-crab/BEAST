import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, useParams } from 'react-router';
import { cn } from '@/lib/utils';
import { useWorkspace, type Workspace, type AiModelKey } from '@/lib/workspace';
import { useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/lib/format';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  useSources,
  useSourceRepos,
  useSyncSource,
  useDeleteSource,
  useUpdateSource,
  useToolRegistry,
  useWorkspaceTools,
  useUpdateWorkspaceTools,
  useValidateToken,
  useDisconnectTool,
  useClaudeStatus,
  useUpdateAiSettings,
} from '@/api/hooks';
import { apiFetch } from '@/api/client';
import { SourceForm } from '@/components/sources/source-form';
import { CompactToolCard } from '@/components/compact-tool-card';
import { IntegrationPanel, type IntegrationStatus } from '@/components/integration-panel';
import { buildIntegrationGroups } from '@/lib/integration-groups';
import { PROVIDER_DISPLAY, sourceDisplayLabel } from '@/lib/provider-display';
import { ProviderIcon } from '@/lib/provider-icons';
import type { Source, DiscoveredRepo, ToolDefinition } from '@/api/types';
import { RepoPicker } from '@/components/sources/repo-picker';
import { LanguageSelect } from '@/components/language-select';
import { useAuth } from '@/lib/auth';
import { useCurrentWorkspaceRole, canWrite } from '@/lib/permissions';

type SettingsSection = 'general' | 'ai' | 'tools';

export function SettingsPage() {
  const { t } = useTranslation();
  const { currentWorkspace, refetchWorkspaces } = useWorkspace();
  const { user } = useAuth();
  const wsRole = useCurrentWorkspaceRole();
  const canEdit = user ? canWrite(user.role, wsRole ?? undefined) : false;
  const location = useLocation();
  const { section: sectionParam } = useParams<{ section?: string }>();
  const section: SettingsSection = (sectionParam === 'ai' || sectionParam === 'tools') ? sectionParam : 'general';
  const sourcesRef = useRef<HTMLDivElement>(null);
  const [highlightSources, setHighlightSources] = useState(false);

  useEffect(() => {
    if (section === 'general' && location.hash === '#sources') {
      const raf = requestAnimationFrame(() => {
        sourcesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setHighlightSources(true);
      });
      const timer = setTimeout(() => setHighlightSources(false), 2000);
      return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
    }
  }, [location.hash, section]);

  if (!currentWorkspace) return null;

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <div>
          <h1 className="beast-page-title">{t('settings.title')}</h1>
          <p className="beast-page-subtitle">
            {t('settings.subtitle')}
          </p>
        </div>

        {section === 'general' && (
          <>
            <div className="settings-main">
              <EditSection
                workspace={currentWorkspace}
                onUpdated={refetchWorkspaces}
                readOnly={!canEdit}
              />
            </div>

            {canEdit && (
              <div ref={sourcesRef} id="sources" className={cn('settings-main', highlightSources && 'beast-highlight-pulse')}>
                <SourcesSection workspaceId={currentWorkspace.id} />
              </div>
            )}

            {canEdit && (
              <DangerZone
                workspace={currentWorkspace}
                onDeleted={async () => {
                  await refetchWorkspaces();
                }}
              />
            )}
          </>
        )}

        {section === 'ai' && canEdit && (
          <>
            <AiCapabilitiesSection
              workspace={currentWorkspace}
              onUpdated={refetchWorkspaces}
            />
            <ScanDepthSection />
          </>
        )}

        {section === 'tools' && canEdit && (
          <SecurityToolsSection workspaceId={currentWorkspace.id} />
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

// ── AI Capabilities Section ──────────────────────────────────

const AI_TECHNIQUES = [
  { key: 'ai_analysis_enabled' as const, wsField: 'aiAnalysisEnabled' as const, modelKey: 'ai_model_analyzer' as const, modelWsField: 'aiModelAnalyzer' as const, titleKey: 'settings.aiAnalysis', descKey: 'settings.aiAnalysisDesc' },
  { key: 'ai_scanning_enabled' as const, wsField: 'aiScanningEnabled' as const, modelKey: 'ai_model_scanner' as const, modelWsField: 'aiModelScanner' as const, titleKey: 'settings.aiScanning', descKey: 'settings.aiScanningDesc' },
  { key: 'ai_triage_enabled' as const, wsField: 'aiTriageEnabled' as const, modelKey: 'ai_model_triage' as const, modelWsField: 'aiModelTriage' as const, titleKey: 'settings.aiTriage', descKey: 'settings.aiTriageDesc' },
] as const;

const AI_MODEL_OPTIONS: { value: AiModelKey; label: string; cost: string }[] = [
  { value: 'haiku', label: 'Haiku', cost: '$' },
  { value: 'sonnet', label: 'Sonnet', cost: '$$' },
  { value: 'opus', label: 'Opus', cost: '$$$' },
];

function AiCapabilitiesSection({
  workspace,
  onUpdated,
}: {
  workspace: Workspace;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const { data: claudeStatus, isLoading: claudeLoading } = useClaudeStatus();
  const updateAi = useUpdateAiSettings(workspace.id);

  function handleToggle(key: typeof AI_TECHNIQUES[number]['key'], enabled: boolean) {
    updateAi.mutate({ [key]: enabled }, { onSuccess: onUpdated });
  }

  function handleModelChange(modelKey: typeof AI_TECHNIQUES[number]['modelKey'], value: AiModelKey) {
    updateAi.mutate({ [modelKey]: value }, { onSuccess: onUpdated });
  }

  const status = claudeStatus?.status ?? 'unreachable';
  const isOk = status === 'authenticated';
  const isRateLimited = status === 'rate_limited';
  const dotClass = (isOk || isRateLimited) ? 'beast-claude-status-dot-ok' : 'beast-claude-status-dot-error';
  const valueClass = isOk ? 'beast-claude-status-value-ok'
    : isRateLimited ? 'beast-claude-status-value-warn'
    : 'beast-claude-status-value-error';
  const statusLabel = isOk ? t('settings.claudeAuthenticated')
    : isRateLimited ? t('settings.claudeRateLimited')
    : status === 'not_authenticated' ? t('settings.claudeNotAuthenticated')
    : t('settings.claudeUnreachable');

  return (
    <div className="beast-card">
      <div className="beast-ai-section-header">
        <div>
          <h2 className="beast-card-title">{t('settings.aiCapabilities')}</h2>
          <p className="beast-card-subtitle">{t('settings.aiCapabilitiesSubtitle')}</p>
        </div>
        <div className="beast-claude-status-inline">
          {claudeLoading ? (
            <>
              <div className="beast-brief-spinner" />
              <span className="beast-claude-status-value">{t('settings.claudeChecking')}</span>
            </>
          ) : (
            <>
              <div className={cn('beast-claude-status-dot', dotClass)} />
              <span className="beast-claude-status-label">{t('settings.claudeStatus')}:</span>
              <span className={cn('beast-claude-status-value', valueClass)}>
                {statusLabel}
              </span>
            </>
          )}
        </div>
      </div>

      {!claudeLoading && !isOk && !isRateLimited && (
        <div className="beast-claude-status-hint-block">
          <span
            dangerouslySetInnerHTML={{
              __html: status === 'not_authenticated'
                ? t('settings.claudeAuthHint')
                : t('settings.claudeUnreachableHint'),
            }}
          />
        </div>
      )}

      <div className="settings-ai-row">
        {AI_TECHNIQUES.map((tech) => {
          const enabled = workspace[tech.wsField];
          const currentModel = workspace[tech.modelWsField] ?? 'opus';
          return (
            <div key={tech.key} className="beast-ai-card">
              <div className="beast-ai-card-header">
                <h3 className="beast-ai-card-title">{t(tech.titleKey)}</h3>
                <label className="beast-toggle-label">
                  <input
                    type="checkbox"
                    className="beast-toggle"
                    checked={enabled}
                    onChange={(e) => handleToggle(tech.key, e.target.checked)}
                  />
                </label>
              </div>
              <p className="beast-ai-card-desc">{t(tech.descKey)}</p>
              <div className="beast-ai-card-model">
                <label className="beast-label-inline">{t('settings.aiModel')}</label>
                <select
                  className="beast-select beast-select-sm"
                  value={currentModel}
                  onChange={(e) => handleModelChange(tech.modelKey, e.target.value as AiModelKey)}
                  disabled={!enabled}
                >
                  {AI_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.cost})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
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
  const categories = ['secrets', 'sast', 'sca', 'iac', 'pii'] as const;
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
    if (diffMin < 1) return t('common.justNow');
    if (diffMin < 60) return t('common.minutesAgo', { count: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t('common.hoursAgo', { count: diffH });
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
  const [editingToken, setEditingToken] = useState(false);

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
            {(source.orgName || source.provider !== 'local') && (
              <span className="beast-source-org">
                {sourceDisplayLabel(source)}
              </span>
            )}
            {repoCount > 0 && (
              <span className="beast-source-meta">
                {t('common.reposCount', { count: repoCount })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="beast-source-detail">
              {t('sources.lastSynced')}: {formatLastSynced(source.lastSyncedAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink" onClick={(e) => e.stopPropagation()}>
          {source.provider !== 'local' && (
            <button
              onClick={() => setEditingToken(!editingToken)}
              className="beast-source-edit-btn"
              title={t('sources.updateToken')}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7 7 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.248a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a7 7 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a7 7 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a7 7 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
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

      {/* Inline token editor */}
      {editingToken && (
        <div className="beast-source-expand">
          <TokenUpdateForm source={source} onDone={() => setEditingToken(false)} />
        </div>
      )}

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

function isBitbucketAccessToken(token: string): boolean {
  return token.startsWith('ATCTT3x');
}

function TokenUpdateForm({ source, onDone }: { source: Source; onDone: () => void }) {
  const { t } = useTranslation();
  const updateSource = useUpdateSource();
  const [newToken, setNewToken] = useState('');
  const [username, setUsername] = useState('');

  const needsUsername = source.provider === 'bitbucket' && newToken.length > 0 && !isBitbucketAccessToken(newToken);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!newToken.trim()) return;
    await updateSource.mutateAsync({
      id: source.id,
      accessToken: newToken.trim(),
      ...(needsUsername ? { username: username.trim() } : {}),
    });
    setNewToken('');
    setUsername('');
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="beast-token-update-row">
      <input
        type="text"
        autoComplete="off"
        className="beast-input beast-input-sm"
        style={{ WebkitTextSecurity: 'disc' } as any}
        placeholder={t('sources.newTokenPlaceholder')}
        value={newToken}
        onChange={(e) => setNewToken(e.target.value)}
        autoFocus
      />
      {needsUsername && (
        <input
          type="text"
          autoComplete="off"
          className="beast-input beast-input-sm"
          placeholder="your-email@company.com"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      )}
      <button
        type="submit"
        disabled={!newToken.trim() || updateSource.isPending}
        className="beast-btn beast-btn-primary beast-btn-sm"
      >
        {updateSource.isPending ? t('common.saving') : t('sources.updateTokenBtn')}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="beast-btn beast-btn-ghost beast-btn-sm"
      >
        {t('common.cancel')}
      </button>
    </form>
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

// ── Scan Depth Section ──────────────────────────────────────

type ScanDepth = 1500 | 500 | 100;

const SCAN_DEPTH_PRESETS: {
  depth: ScanDepth;
  labelKey: string;
  tagKey: string;
  findingsMult: string;
  badgeKey?: string;
  badgeRed?: boolean;
}[] = [
  { depth: 1500, labelKey: 'settings.scanDepth.quick.label',    tagKey: 'settings.scanDepth.quick.tag',    findingsMult: '1' },
  { depth: 500,  labelKey: 'settings.scanDepth.standard.label', tagKey: 'settings.scanDepth.standard.tag', findingsMult: '3',  badgeKey: 'settings.scanDepth.standard.badge' },
  { depth: 100,  labelKey: 'settings.scanDepth.deep.label',     tagKey: 'settings.scanDepth.deep.tag',     findingsMult: '10', badgeKey: 'settings.scanDepth.deep.badge', badgeRed: true },
];

const REPO_PROFILES: { key: 'small' | 'medium' | 'large'; files: number; hintN: string }[] = [
  { key: 'small',  files: 500,   hintN: '500' },
  { key: 'medium', files: 2500,  hintN: '2,500' },
  { key: 'large',  files: 10000, hintN: '10,000' },
];

const SINGLE_MODULE_THRESHOLD = 2000;
const MINUTES_PER_MODULE = 4;

function estimateModules(depth: ScanDepth, files: number) {
  if (files <= SINGLE_MODULE_THRESHOLD && depth >= SINGLE_MODULE_THRESHOLD) return 1;
  return Math.ceil(files / depth);
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `~${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `~${h}h` : `~${h}h ${m}m`;
}

function costLevel(usd: number): number {
  if (usd <= 5)   return 1;
  if (usd <= 20)  return 2;
  if (usd <= 50)  return 3;
  if (usd <= 100) return 4;
  return 5;
}

// Full-scan cost (analyzer + scanner + triage + AI research, end-to-end) per
// (depth × repo profile) combination. Anchored on real BEAST benchmarks:
//   reference repo = 7,622 INTERESTING files (≈LARGE): B@1500=$10, B@500=$39, B@100=$160.
// For small repos, QUICK == STANDARD because both run 1 Sniper module with the same
// files cached — module size doesn't matter when files ≤ depth.
type RepoSizeKey = typeof REPO_PROFILES[number]['key'];
const COST_TABLE: Record<ScanDepth, Record<RepoSizeKey, number>> = {
  1500: { small: 3,  medium: 5,  large: 14  },
  500:  { small: 3,  medium: 13, large: 50  },
  100:  { small: 10, medium: 50, large: 210 },
};
// Max x20 calibrated against real LARGE+DEEP scan: $210 ≈ 50% of one 5h window.
// Max x5 = 1/4 of x20 capacity (since x20 is 4× rate-limit of x5).
const MAX20_USD_PER_WINDOW = 420; // $210 = 50% of window
const MAX5_USD_PER_WINDOW = 105;  // x20 / 4

function fullScanCost(depth: ScanDepth, profile: RepoSizeKey): number {
  return COST_TABLE[depth][profile];
}

function formatApiCost(depth: ScanDepth, profile: RepoSizeKey): string {
  const cost = fullScanCost(depth, profile);
  if (cost < 10)  return `~$${cost.toFixed(1)}`;
  if (cost < 50)  return `~$${Math.round(cost)}`;
  if (cost < 200) return `~$${Math.round(cost / 5) * 5}`;
  return `~$${Math.round(cost / 25) * 25}`;
}

function formatWindowUsage(cost: number, budgetPerWindow: number): string {
  const ratio = cost / budgetPerWindow;
  if (ratio < 0.02) return '<2% of 5h window';
  if (ratio <= 1)   return `~${Math.max(2, Math.round(ratio * 100))}% of 5h window`;
  if (ratio <= 5)   return `~${ratio.toFixed(1)}× of 5h window`;
  return `~${Math.round(ratio)}× of 5h window`;
}

function formatMax5Usage(depth: ScanDepth, profile: RepoSizeKey): string {
  return formatWindowUsage(fullScanCost(depth, profile), MAX5_USD_PER_WINDOW);
}

function formatMax20Usage(depth: ScanDepth, profile: RepoSizeKey): string {
  return formatWindowUsage(fullScanCost(depth, profile), MAX20_USD_PER_WINDOW);
}

type AnimatedProfile = { modules: number; minutes: number; level: number };

function buildSnapshot(depth: ScanDepth): AnimatedProfile[] {
  return REPO_PROFILES.map((p) => {
    const modules = estimateModules(depth, p.files);
    return {
      modules,
      minutes: modules * MINUTES_PER_MODULE,
      level: costLevel(fullScanCost(depth, p.key)),
    };
  });
}

function ScanDepthSection() {
  const { t } = useTranslation();
  const { currentWorkspace, refetchWorkspaces } = useWorkspace();
  const updateAi = useUpdateAiSettings(currentWorkspace?.id);
  const persisted = (currentWorkspace?.scanDepth ?? 500) as ScanDepth;
  const [selected, setSelected] = useState<ScanDepth>(persisted);
  const [animated, setAnimated] = useState<AnimatedProfile[]>(() => buildSnapshot(persisted));

  // Re-sync local state when workspace changes (switching workspaces)
  useEffect(() => {
    setSelected(persisted);
  }, [persisted]);

  function handleSelect(depth: ScanDepth) {
    if (depth === selected) return;
    const previous = selected;
    setSelected(depth);
    updateAi.mutate(
      { scan_depth: depth },
      {
        onSuccess: () => {
          refetchWorkspaces();
        },
        onError: () => {
          setSelected(previous);
        },
      },
    );
  }

  useEffect(() => {
    const targets = buildSnapshot(selected);
    const start = animated.map((a) => ({ ...a }));
    const duration = 700;
    const startTime = performance.now();
    let raf = 0;

    function frame() {
      const t = Math.min(1, (performance.now() - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(REPO_PROFILES.map((_, i) => ({
        modules: Math.round(start[i].modules + (targets[i].modules - start[i].modules) * eased),
        minutes: Math.round(start[i].minutes + (targets[i].minutes - start[i].minutes) * eased),
        level: start[i].level + (targets[i].level - start[i].level) * eased,
      })));
      if (t < 1) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="beast-card">
      <h2 className="beast-card-title">{t('settings.scanDepth.title')}</h2>
      <p className="beast-card-subtitle">{t('settings.scanDepth.subtitle')}</p>

      <div className="beast-preset-tabs">
        {SCAN_DEPTH_PRESETS.map((p) => (
          <button
            key={p.depth}
            type="button"
            onClick={() => handleSelect(p.depth)}
            disabled={updateAi.isPending}
            className={cn('beast-preset-tab', selected === p.depth && 'beast-preset-tab-active')}
          >
            {p.badgeKey && (
              <div className={cn('beast-preset-tab-badge', p.badgeRed && 'beast-preset-tab-badge-red')}>{t(p.badgeKey)}</div>
            )}
            <div className="beast-preset-tab-title">{t(p.labelKey)}</div>
            <div className="beast-preset-tab-tag">{t(p.tagKey)}</div>
            <div className="beast-preset-tab-stats">
              <div className="beast-preset-stat">
                <div className="beast-preset-stat-label">{t('settings.scanDepth.filesPerAgent')}</div>
                <div className="beast-preset-stat-val">{p.depth}</div>
              </div>
              <div className="beast-preset-stat">
                <div className="beast-preset-stat-label">{t('settings.scanDepth.findings')}</div>
                <div className="beast-preset-stat-val beast-preset-stat-val-red">
                  <span className="beast-preset-stat-prefix">×</span>{p.findingsMult}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="beast-preset-panel">
        <div className="beast-preset-panel-label">{t('settings.scanDepth.previewLabel')}</div>
        <div className="beast-repo-preview-grid">
          {REPO_PROFILES.map((profile, idx) => {
              const { minutes, level } = animated[idx];
              const time = formatDuration(minutes);
              return (
                <div key={profile.key} className="beast-repo-preview-card">
                  <div className="beast-repo-preview-header">
                    <span className="beast-repo-preview-size">{t(`settings.scanDepth.sizes.${profile.key}`)}</span>
                    <span className="beast-repo-preview-count">{t('settings.scanDepth.filesApprox', { n: profile.hintN })}</span>
                  </div>
                  <div className="beast-repo-preview-desc">
                    {t(`settings.scanDepth.sizeDesc.${profile.key}`)}
                  </div>
                  <div className="beast-repo-preview-stats">
                    <div>
                      <span className="beast-repo-preview-time">{time}</span>
                    </div>
                    <div className="beast-repo-preview-cost-wrap">
                      <div className="beast-repo-preview-cost">
                        {[1, 2, 3, 4, 5].map((i) => {
                          const fill = Math.max(0, Math.min(1, level - (i - 1)));
                          const bounce = 1 + 0.3 * Math.sin(fill * Math.PI);
                          return (
                            <span
                              key={i}
                              className="beast-repo-preview-cost-dot beast-repo-preview-cost-on"
                              style={{
                                opacity: 0.22 + 0.78 * fill,
                                transform: `scale(${bounce})`,
                              }}
                            >$</span>
                          );
                        })}
                      </div>
                      <span className="beast-info-icon" tabIndex={0}>
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 16v-4" />
                          <path d="M12 8h.01" />
                        </svg>
                        <div className="beast-info-tooltip">
                          <div className="beast-info-tooltip-row">
                            <span className="beast-info-tooltip-label">{t('settings.scanDepth.cost.api')}</span>
                            <span className="beast-info-tooltip-val">{formatApiCost(selected, profile.key)}</span>
                          </div>
                          <div className="beast-info-tooltip-row">
                            <span className="beast-info-tooltip-label">Max x5 plan</span>
                            <span className="beast-info-tooltip-val">{formatMax5Usage(selected, profile.key)}</span>
                          </div>
                          <div className="beast-info-tooltip-row">
                            <span className="beast-info-tooltip-label">Max x20 plan</span>
                            <span className="beast-info-tooltip-val">{formatMax20Usage(selected, profile.key)}</span>
                          </div>
                        </div>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
