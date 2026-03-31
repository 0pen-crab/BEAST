import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useWorkspace } from '@/lib/workspace';
import { useToolRegistry, useUpdateWorkspaceTools, useValidateToken, useSources, useDeleteSource, useImportFromSource } from '@/api/hooks';
import { StepProgress } from '@/components/sources/step-progress';
import { SourceForm } from '@/components/sources/source-form';
import { RepoPicker } from '@/components/sources/repo-picker';
import { CompactToolCard } from '@/components/compact-tool-card';
import { IntegrationPanel, type IntegrationStatus } from '@/components/integration-panel';
import { buildIntegrationGroups } from '@/lib/integration-groups';
import { PROVIDER_DISPLAY } from '@/lib/provider-display';
import { LanguageSelect } from '@/components/language-select';
import { BeastAcronym } from '@/components/beast-acronym';
import { ProviderIcon } from '@/lib/provider-icons';
import { useWizardStepState, useWizardMaxStep, clearWizardState } from '@/lib/use-wizard-state';
import type { Source, DiscoveredRepo, ToolDefinition } from '@/api/types';

// ── Shared two-column layout ─────────────────────────────────

function WizardLayout({
  main,
  sidebar,
}: {
  main: React.ReactNode;
  sidebar: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row gap-4 items-start">
      <div className="w-full md:flex-[0.7] min-w-0">{main}</div>
      <div className="w-full md:flex-[0.3] min-w-0 beast-card md:sticky md:top-6">
        {sidebar}
      </div>
    </div>
  );
}

// ── Step 1: Create workspace ─────────────────────────────────

function Step1({
  onCreated,
  isCreated,
  workspaceId,
}: {
  onCreated: (workspaceId: number) => void;
  isCreated: boolean;
  workspaceId: number | null;
}) {
  const { t } = useTranslation();
  const { refetchWorkspaces } = useWorkspace();
  const [name, setName] = useWizardStepState(workspaceId, 'step1.name', '');
  const [description, setDescription] = useWizardStepState(workspaceId, 'step1.description', '');
  const [defaultLanguage, setDefaultLanguage] = useWizardStepState(workspaceId, 'step1.language', 'en');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          default_language: defaultLanguage,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch((err) => {
          console.error('[onboarding] Failed to parse error response:', err);
          return {};
        });
        throw new Error(data.message || data.error || 'Failed to create workspace');
      }
      const ws = await res.json();
      await refetchWorkspaces();
      onCreated(ws.id);
    } catch (err: any) {
      setError(err.message || 'Failed to create workspace');
    } finally {
      setLoading(false);
    }
  }

  return (
    <WizardLayout
      main={
        <div className="beast-card">
          <form id="step1-form" onSubmit={handleSubmit} className="beast-form-stack">
            {error && <div className="beast-error">{error}</div>}

            <div className="beast-form-group">
              <label htmlFor="ws-name" className="beast-label">
                {t('onboarding.workspaceName')}
              </label>
              <input
                id="ws-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                className="beast-input"
                placeholder={t('onboarding.placeholder')}
              />
            </div>

            <div className="beast-form-group">
              <label htmlFor="ws-desc" className="beast-label">
                {t('onboarding.description')}
              </label>
              <input
                id="ws-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="beast-input"
                placeholder={t('onboarding.descPlaceholder')}
              />
            </div>

            <div className="beast-form-group">
              <label htmlFor="ws-lang" className="beast-label">
                {t('workspace.defaultLanguage')}
              </label>
              <p className="beast-form-hint">
                {t('workspace.defaultLanguageDesc')}
              </p>
              <LanguageSelect value={defaultLanguage} onChange={setDefaultLanguage} />
            </div>
          </form>
        </div>
      }
      sidebar={
        isCreated ? (
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5 text-beast-red mb-2">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              <span className="text-sm font-medium">{t('onboarding.workspaceCreated')}</span>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            form="step1-form"
            disabled={loading || !name.trim()}
            className="beast-btn beast-btn-primary w-full"
          >
            {loading
              ? t('onboarding.creating')
              : t('onboarding.createWorkspace')}
          </button>
        )
      }
    />
  );
}

// ── Step 2: Configure tools ──────────────────────────────────

function ToolConfigStep({
  workspaceId,
  onContinue,
  onSkip,
}: {
  workspaceId: number;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const { data: tools = [], isLoading } = useToolRegistry();
  const updateTools = useUpdateWorkspaceTools(workspaceId);
  const validateToken = useValidateToken(workspaceId);

  const [enabled, setEnabled] = useWizardStepState<Record<string, boolean>>(workspaceId, 'step2.enabled', {});
  const [integrationStates, setIntegrationStates] = useWizardStepState<
    Record<string, { status: IntegrationStatus; error?: string }>
  >(workspaceId, 'step2.integrations', {});
  const [initialized, setInitialized] = useState(false);

  if (!initialized && tools.length > 0 && Object.keys(enabled).length === 0) {
    const defaults: Record<string, boolean> = {};
    for (const tool of tools) {
      defaults[tool.key] = tool.recommended;
    }
    setEnabled(defaults);
    setInitialized(true);
  } else if (!initialized && Object.keys(enabled).length > 0) {
    // Already restored from storage
    setInitialized(true);
  }

  function handleToggle(key: string, value: boolean) {
    setEnabled((prev) => ({ ...prev, [key]: value }));
  }

  function handleValidate(groupKey: string, toolKey: string, credentials: Record<string, string>) {
    setIntegrationStates((prev) => ({ ...prev, [groupKey]: { status: 'validating' } }));

    validateToken.mutate(
      { tool_key: toolKey, credentials },
      {
        onSuccess: () => {
          setIntegrationStates((prev) => ({ ...prev, [groupKey]: { status: 'connected' } }));
          // Save tool selections + credentials immediately
          const selections = Object.entries(enabled).map(([tool_key, isEnabled]) => ({
            tool_key,
            enabled: isEnabled,
            ...(tool_key === toolKey ? { credentials } : {}),
          }));
          updateTools.mutate(selections);
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

  function handleContinue() {
    const selections = Object.entries(enabled).map(([tool_key, isEnabled]) => ({
      tool_key,
      enabled: isEnabled,
    }));
    updateTools.mutate(selections, { onSuccess: () => onContinue() });
  }

  function handleSkip() {
    const selections = tools
      .filter((t) => t.recommended)
      .map((t) => ({ tool_key: t.key, enabled: true }));
    updateTools.mutate(selections, { onSuccess: () => onSkip() });
  }

  const categories = tools.reduce<Record<string, ToolDefinition[]>>((acc, tool) => {
    (acc[tool.category] ??= []).push(tool);
    return acc;
  }, {});

  const integrationGroups = buildIntegrationGroups(tools, enabled);

  const canContinue =
    integrationGroups.length === 0 ||
    integrationGroups.every((g) => integrationStates[g.groupKey]?.status === 'connected');

  const pendingCount = integrationGroups.filter(
    (g) => integrationStates[g.groupKey]?.status !== 'connected',
  ).length;

  if (isLoading) {
    return (
      <div className="beast-card text-center">
        <p className="text-sm text-th-text-muted">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <WizardLayout
      main={
        <div className="beast-card">
          <div className="beast-card-title">
            {t('onboarding.toolsTitle')}
            <span className="text-sm text-th-text-muted mx-2 normal-case tracking-normal font-normal">{t('onboarding.toolsTitleOr')}</span>
            <button
              type="button"
              onClick={handleSkip}
              disabled={updateTools.isPending}
              className="beast-card-title !text-beast-red hover:!text-beast-red-light border-b border-beast-red/40 hover:border-beast-red transition-colors cursor-pointer"
            >
              {t('onboarding.toolsSkipLink')}
            </button>
          </div>

          {Object.entries(categories).map(([category, categoryTools]) => (
            <div key={category} className="mb-6">
              <h3 className="beast-card-title">
                {t(`tools.categories.${category}`)}
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                {categoryTools.map((tool) => (
                  <CompactToolCard
                    key={tool.key}
                    tool={tool}
                    enabled={enabled[tool.key] ?? false}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      }
      sidebar={
        <>
          <div className="beast-card-title">{t('onboarding.integrations')}</div>

          {integrationGroups.length === 0 ? (
            <p className="text-xs text-th-text-muted mb-4">{t('onboarding.noIntegrations')}</p>
          ) : (
            <div className="space-y-2.5 mb-4">
              {integrationGroups.map((group) => (
                <IntegrationPanel
                  key={group.groupKey}
                  name={group.name}
                  iconLetter={group.iconLetter}
                  iconColor={group.iconColor}
                  iconUrl={group.iconUrl}
                  credentials={group.credentials}
                  usedBy={group.usedBy}
                  status={integrationStates[group.groupKey]?.status ?? 'pending'}
                  error={integrationStates[group.groupKey]?.error}
                  onValidate={(creds) => handleValidate(group.groupKey, group.validatorToolKey, creds)}
                />
              ))}
            </div>
          )}

          {integrationGroups.length > 0 && (
            <div className="text-[10px] text-center mb-2.5">
              {canContinue ? (
                <span className="text-beast-red-light">{t('onboarding.allIntegrationsConnected')}</span>
              ) : (
                <span className="text-beast-red">
                  {t('onboarding.integrationsNeedTokens', { count: pendingCount })}
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue || updateTools.isPending}
            className={cn(
              'beast-btn w-full',
              canContinue ? 'beast-btn-primary' : '',
            )}
            style={!canContinue ? { background: '#555', color: '#888', cursor: 'not-allowed' } : {}}
          >
            {updateTools.isPending ? t('onboarding.savingTools') : t('onboarding.continueTools')}
          </button>
        </>
      }
    />
  );
}

// ── Step 3: Connect source ───────────────────────────────────

function SourceStep({
  workspaceId,
  onContinue,
}: {
  workspaceId: number;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const { data: sources = [] } = useSources(workspaceId);
  const deleteSource = useDeleteSource();

  // Real repo counts from API
  const [repoCounts, setRepoCounts] = useState<Record<number, number>>({});

  function fetchRepoCounts() {
    for (const source of sources) {
      apiFetch(`/api/sources/${source.id}/repos`)
        .then((res) => (res.ok ? res.json() : []))
        .then((repos: DiscoveredRepo[]) => {
          setRepoCounts((prev) => ({ ...prev, [source.id]: repos.length }));
        })
        .catch((err) => {
          console.error(`[onboarding] Failed to fetch repo count for source ${source.id}:`, err);
        });
    }
  }

  // Fetch counts on mount and whenever sources list changes
  useEffect(() => {
    if (sources.length > 0) fetchRepoCounts();
  }, [sources]);

  function handleSourceConnected() {
    fetchRepoCounts();
  }

  function handleRemoveSource(sourceId: number) {
    deleteSource.mutate(sourceId);
  }

  const canContinue = sources.length > 0;

  return (
    <WizardLayout
      main={
        <div className="beast-card">
          <div className="beast-card-title">{t('onboarding.connectSource')}</div>
          <p className="beast-card-subtitle">{t('onboarding.connectSourceDesc')}</p>
          <SourceForm workspaceId={workspaceId} onConnected={handleSourceConnected} />
        </div>
      }
      sidebar={
        <>
          <div className="beast-card-title">{t('sources.title')}</div>
          {sources.length === 0 ? (
            <p className="text-xs text-th-text-muted mb-4">{t('sources.noSourcesYet')}</p>
          ) : (
            <div className="space-y-2 mb-4">
              {sources.map((source) => {
                const count = repoCounts[source.id] ?? 0;
                const prov = PROVIDER_DISPLAY[source.provider] ?? PROVIDER_DISPLAY.local;
                const label = source.orgName || source.provider;
                return (
                  <div key={source.id} className="flex items-center gap-2.5 border border-th-border bg-th-bg px-3 py-2">
                    <ProviderIcon
                      provider={source.provider}
                      className={cn(
                        'h-5 w-5 shrink-0',
                        source.provider === 'github' ? 'text-th-text' :
                        source.provider === 'gitlab' ? 'text-orange-500' :
                        source.provider === 'bitbucket' ? 'text-blue-500' :
                        'text-th-text-muted',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className={cn('text-sm font-medium truncate', prov.color)}>{label}</div>
                      {count > 0 && (
                        <div className="text-[11px] text-th-text-muted">
                          {t('sources.reposFound', { count })}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => handleRemoveSource(source.id)}
                      className="text-th-text-muted hover:text-beast-red transition-colors flex-shrink-0"
                      title={t('sources.remove')}>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <button type="button" onClick={onContinue}
            disabled={!canContinue}
            className={cn('beast-btn w-full', canContinue ? 'beast-btn-primary' : '')}
            style={!canContinue ? { background: '#555', color: '#888', cursor: 'not-allowed' } : {}}>
            {t('onboarding.continueSource')}
          </button>
        </>
      }
    />
  );
}

// ── Step 4: Import repos ─────────────────────────────────────

type FetchStatus = 'pending' | 'fetching' | 'done' | 'error';

interface SourceFetchState {
  source: Source;
  status: FetchStatus;
  repos: DiscoveredRepo[];
  error?: string;
}

function ImportStep({
  workspaceId,
  onDone,
  isActive,
}: {
  workspaceId: number;
  onDone: () => void;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const { data: sources = [], isLoading: sourcesLoading } = useSources(workspaceId);
  const [fetchStates, setFetchStates] = useState<SourceFetchState[]>([]);
  const [fetching, setFetching] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const importMutation = useImportFromSource();
  const fetchedSourceIds = useRef<string>('');

  // Fingerprint of current sources — re-fetch when this changes
  const currentSourceIds = sources.map(s => s.id).sort().join(',');

  // Fetch discoverable repos for each source from the API.
  // Only runs when step 4 is active AND sources have changed since last fetch.
  useEffect(() => {
    if (!isActive || sourcesLoading || sources.length === 0) return;
    if (currentSourceIds === fetchedSourceIds.current) return;

    fetchedSourceIds.current = currentSourceIds;
    setFetching(true);
    setImportedCount(null);
    setSelections({});
    setFetchStates(sources.map(s => ({ source: s, status: 'pending' as FetchStatus, repos: [] })));

    (async () => {
      for (const source of sources) {
        setFetchStates(prev => prev.map(s =>
          s.source.id === source.id ? { ...s, status: 'fetching' } : s));
        try {
          const res = await apiFetch(`/api/sources/${source.id}/repos`);
          const repos: DiscoveredRepo[] = res.ok ? await res.json() : [];
          setFetchStates(prev => prev.map(s =>
            s.source.id === source.id ? { ...s, status: 'done', repos } : s));
        } catch (err: any) {
          setFetchStates(prev => prev.map(s =>
            s.source.id === source.id ? { ...s, status: 'error', error: err.message } : s));
        }
      }
      setFetching(false);
    })();
  }, [isActive, sourcesLoading, currentSourceIds]);

  async function handleImport() {
    let total = 0;
    for (const [sourceIdStr, selected] of Object.entries(selections)) {
      if (selected.size === 0) continue;
      try {
        const result = await importMutation.mutateAsync({
          sourceId: Number(sourceIdStr), repos: Array.from(selected),
        });
        total += result.imported;
      } catch { /* continue */ }
    }
    const autoCount = autoImported.reduce((sum, s) => sum + Math.max(s.repos.length, 1), 0);
    setImportedCount(total + autoCount);
  }

  const totalSelected = Object.values(selections).reduce((sum, s) => sum + s.size, 0);

  // Success screen
  if (importedCount !== null) {
    return (
      <WizardLayout
        main={
          <div className="beast-card text-center">
            <div className="mb-4 flex items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center bg-beast-red/10">
                <svg className="h-6 w-6 text-beast-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <p className="text-sm font-medium text-th-text">{t('onboarding.importSuccess', { count: importedCount })}</p>
          </div>
        }
        sidebar={<button onClick={onDone} className="beast-btn beast-btn-primary w-full">{t('onboarding.goToDashboard')}</button>}
      />
    );
  }

  // Loading / fetch progress screen
  const needsFetch = isActive && !sourcesLoading && sources.length > 0 && currentSourceIds !== fetchedSourceIds.current;
  if (sourcesLoading || fetching || needsFetch) {
    const inProgress = fetchStates.length > 0 ? fetchStates : sources.map(s => ({ source: s, status: 'pending' as FetchStatus, repos: [] as DiscoveredRepo[] }));
    return (
      <WizardLayout
        main={
          <div className="beast-card">
            <div className="beast-card-title">{t('onboarding.importRepos')}</div>
            <div className="space-y-3 mt-4">
              {inProgress.map(s => {
                const prov = PROVIDER_DISPLAY[s.source.provider] ?? PROVIDER_DISPLAY.local;
                const label = s.source.orgName || s.source.provider;
                return (
                  <div key={s.source.id} className="flex items-center gap-3">
                    {s.status === 'fetching' && <div className="h-4 w-4 border-2 border-beast-red border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                    {s.status === 'done' && <svg className="h-4 w-4 text-beast-red flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    {s.status === 'error' && <svg className="h-4 w-4 text-beast-red flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>}
                    {s.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-th-border flex-shrink-0" />}
                    <span className={cn('text-sm', s.status === 'pending' ? 'text-th-text-muted' : 'text-th-text')}>
                      {s.status === 'done' ? `${prov.label} (${label}) — ${s.repos.length} repos` : t('onboarding.fetchingRepos', { provider: prov.label, name: label })}
                    </span>
                  </div>
                );
              })}
              {inProgress.length === 0 && (
                <div className="h-4 w-4 border-2 border-beast-red border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          </div>
        }
        sidebar={<div />}
      />
    );
  }

  // Main import screen — separate sources into:
  // 1. Auto-imported: single repos, uploads, or sources where ALL repos are already imported
  // 2. Selectable: org sources with repos that can still be selected
  const autoImported = fetchStates.filter(s =>
    s.status === 'done' && (
      s.repos.length === 0 ||
      s.repos.every((r) => r.imported)
    ),
  );
  const selectable = fetchStates.filter(s =>
    s.status === 'done' &&
    s.repos.length > 0 &&
    s.repos.some((r) => !r.imported),
  );
  const allDone = selectable.length === 0;

  return (
    <WizardLayout
      main={
        <div className="space-y-4">
          {autoImported.length > 0 && (
            <div className="beast-card">
              <div className="beast-card-title">{t('onboarding.alreadyImported')}</div>
              <div className="divide-y divide-th-border-subtle border border-th-border mt-2">
                {autoImported.map(s => {
                  const prov = PROVIDER_DISPLAY[s.source.provider] ?? PROVIDER_DISPLAY.local;
                  const label = s.source.orgName || s.source.provider;
                  const count = s.repos.length;
                  return (
                    <div key={s.source.id} className="flex items-center gap-3 px-3 py-2.5">
                      <ProviderIcon provider={s.source.provider} className={cn('h-4 w-4 shrink-0',
                        s.source.provider === 'github' ? 'text-th-text' :
                        s.source.provider === 'gitlab' ? 'text-orange-500' :
                        s.source.provider === 'bitbucket' ? 'text-blue-500' :
                        'text-th-text-muted',
                      )} />
                      <span className="text-sm text-th-text">{label}</span>
                      {count > 0 && (
                        <span className="text-[11px] text-th-text-muted">{count} repos</span>
                      )}
                      <svg className="h-4 w-4 text-beast-red ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {selectable.map(s => {
            const prov = PROVIDER_DISPLAY[s.source.provider] ?? PROVIDER_DISPLAY.local;
            const label = s.source.orgName || s.source.provider;
            return (
              <div key={s.source.id} className="beast-card">
                <div className="beast-card-title flex items-center gap-2">
                  <span className={prov.color}>{prov.label}</span>
                  <span className="text-th-text-muted font-normal">— {label}</span>
                  <span className="text-[11px] text-th-text-muted font-normal ml-auto">{s.repos.length} repos</span>
                </div>
                <RepoPicker
                  repos={s.repos} sourceId={s.source.id} onImported={() => {}}
                  selectionMode selected={selections[s.source.id] ?? new Set()}
                  onSelectionChange={(sel) => setSelections(prev => ({ ...prev, [s.source.id]: sel }))}
                />
              </div>
            );
          })}
          {allDone && (
            <div className="beast-card text-center">
              <p className="text-sm text-th-text-muted">{t('onboarding.nothingToImport')}</p>
            </div>
          )}
        </div>
      }
      sidebar={
        <>
          {selectable.length > 0 && (
            <button type="button" onClick={handleImport}
              disabled={totalSelected === 0 || importMutation.isPending}
              className={cn('beast-btn w-full mb-2', totalSelected > 0 ? 'beast-btn-primary' : '')}
              style={totalSelected === 0 ? { background: '#555', color: '#888', cursor: 'not-allowed' } : {}}>
              {importMutation.isPending ? t('repoPicker.importing') : t('onboarding.importSelected', { count: totalSelected })}
            </button>
          )}
          <button onClick={onDone} className="beast-btn beast-btn-primary w-full">{t('onboarding.goToDashboard')}</button>
        </>
      }
    />
  );
}

// ── Main component ───────────────────────────────────────────

export { NewWorkspacePage as OnboardingPage };

export function NewWorkspacePage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { theme, setTheme } = useTheme();
  const { workspaces, switchWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const params = useParams<{ '*': string }>();

  // Parse /onboarding/workspaceId/step from wildcard
  const segments = (params['*'] ?? '').split('/').filter(Boolean);
  const urlWorkspaceId = segments[0] ? Number(segments[0]) : null;
  const urlStep = segments[1] ? (Number(segments[1]) as 1 | 2 | 3 | 4) : null;

  const [workspaceId, setWorkspaceId] = useState<number | null>(() => {
    if (!urlWorkspaceId) {
      // No workspace in URL — clear state from a PREVIOUS workspace onboarding,
      // but keep draft state (step 1 form values not yet submitted)
      try {
        const raw = localStorage.getItem('beast_onboarding');
        if (raw) {
          const data = JSON.parse(raw);
          if (data.workspaceId !== null) clearWizardState();
        }
      } catch {
        clearWizardState();
      }
    }
    return urlWorkspaceId;
  });
  const [step, setStepState] = useState<1 | 2 | 3 | 4>(
    urlWorkspaceId && urlStep && urlStep >= 2 && urlStep <= 4 ? urlStep : urlWorkspaceId ? 2 : 1,
  );
  // Track the highest step reached (persisted in localStorage)
  const [maxStep, setMaxStep] = useWizardMaxStep(
    workspaceId,
    urlWorkspaceId && urlStep ? urlStep : urlWorkspaceId ? 2 : 1,
  );

  // Update URL when step or workspaceId changes
  function setStep(newStep: 1 | 2 | 3 | 4) {
    setStepState(newStep);
    if (newStep > maxStep) setMaxStep(newStep);
    if (workspaceId) {
      navigate(`/onboarding/${workspaceId}/${newStep}`, { replace: true });
    }
  }

  const isFirstWorkspace = workspaces.length === 0;

  // Capture whether this was a first-workspace onboarding at mount time
  const wasFirstWorkspace = useRef<boolean | null>(null);
  if (wasFirstWorkspace.current === null) {
    wasFirstWorkspace.current = isFirstWorkspace;
  }

  // Force dark theme during first workspace onboarding, restore on unmount
  useEffect(() => {
    if (!wasFirstWorkspace.current) return;
    const original = localStorage.getItem('beast_theme') as 'dark' | 'light' | null;
    setTheme('dark');
    return () => {
      setTheme(original ?? 'light');
    };
  }, []);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  function handleSourcesContinue() {
    setStep(4);
  }

  function handleDone() {
    clearWizardState();
    if (wasFirstWorkspace.current) setTheme('light');
    if (workspaceId) switchWorkspace(workspaceId);
    navigate('/', { replace: true });
  }

  function getStepStatus(stepNum: number): 'current' | 'completed' | 'pending' {
    if (stepNum === step) return 'current';
    if (stepNum <= maxStep) return 'completed';
    return 'pending';
  }

  const steps = [
    { label: t('onboarding.step1'), status: getStepStatus(1) },
    { label: t('onboarding.step2'), status: getStepStatus(2) },
    { label: t('onboarding.step3'), status: getStepStatus(3) },
    { label: t('onboarding.step4'), status: getStepStatus(4) },
  ];

  return (
    <div className="relative flex min-h-screen flex-col items-center bg-th-bg pt-10">
      {!isFirstWorkspace && (
        <button
          onClick={() => navigate(-1)}
          className="absolute left-6 top-6 flex items-center gap-1.5 text-sm text-th-text-muted hover:text-th-text transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
          </svg>
          {t('common.back')}
        </button>
      )}
      <div className="w-full max-w-5xl px-4">

        {/* Logo */}
        <div className="mb-4 text-center">
          <div className="inline-flex items-center gap-5">
            <img src={theme === 'light' ? '/beast_kind_small.png' : '/beast_angry_small.png'} alt="BEAST" className="h-[72px] w-[72px]" />
            <span
              className="text-[42px] leading-[0.85] tracking-[0.08em] text-beast-red"
              style={{ fontFamily: "'Anton', sans-serif" }}
            >
              BEAST
            </span>
            <div
              className="h-[52px] flex-shrink-0"
              style={{
                width: '1.5px',
                background: 'linear-gradient(to bottom, transparent, var(--color-beast-red), transparent)',
              }}
            />
            <BeastAcronym size="sm" />
          </div>
        </div>

        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="beast-card-title">
            {isFirstWorkspace ? t('onboarding.title') : t('onboarding.titleAdd')}
          </h1>
        </div>

        {/* Step progress */}
        <div className="mb-6">
          <StepProgress
            steps={steps}
            onStepClick={(index) => {
              const targetStep = (index + 1) as 1 | 2 | 3 | 4;
              if (targetStep !== step && targetStep <= maxStep) setStep(targetStep);
            }}
          />
        </div>

        {/* Step content — all steps rendered, inactive ones hidden to preserve state */}
        <div className={step === 1 ? '' : 'hidden'}>
          <Step1
            workspaceId={workspaceId}
            isCreated={workspaceId !== null}
            onCreated={(id) => {
              setWorkspaceId(id);
              setMaxStep(2);
              setStepState(2);
              navigate(`/onboarding/${id}/2`, { replace: true });
            }}
          />
        </div>

        {workspaceId !== null && (
          <div className={step === 2 ? '' : 'hidden'}>
            <ToolConfigStep
              workspaceId={workspaceId}
              onContinue={() => setStep(3)}
              onSkip={() => setStep(3)}
            />
          </div>
        )}

        {workspaceId !== null && (
          <div className={step === 3 ? '' : 'hidden'}>
            <SourceStep workspaceId={workspaceId} onContinue={handleSourcesContinue} />
          </div>
        )}

        {workspaceId !== null && (
          <div className={step === 4 ? '' : 'hidden'}>
            <ImportStep workspaceId={workspaceId} onDone={handleDone} isActive={step === 4} />
          </div>
        )}
      </div>
    </div>
  );
}

