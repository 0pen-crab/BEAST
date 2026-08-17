import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useConnectSource, useImportFromSource, useUploadRepoZip } from '@/api/hooks';
import { apiFetch } from '@/api/client';
import { cn } from '@/lib/utils';

type Tab = 'single' | 'git-server' | 'local';
type Deployment = 'cloud' | 'self-hosted';

function normalizeUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

const PROVIDERS = ['GitHub', 'GitLab', 'Bitbucket'] as const;

function ProviderHint() {
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-th-text-muted">
      <span>Works with</span>
      {PROVIDERS.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-th-border">·</span>}
          <span>{p}</span>
        </span>
      ))}
    </div>
  );
}

const TOKEN_PLACEHOLDERS: Record<string, string> = {
  bitbucket: 'ATBBxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  github: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  gitlab: 'glpat-xxxxxxxxxxxxxxxxxxxx',
};

// Known cloud REST API hosts per provider (web host ≠ API host for GitHub/Bitbucket).
const CLOUD_API_BASE: Record<string, string> = {
  bitbucket: 'https://api.bitbucket.org/2.0',
  github: 'https://api.github.com',
  gitlab: 'https://gitlab.com',
};

// Extract the org/user/workspace name from cloud input. Accepts a bare name
// ("acme-org"), a host+path ("github.com/acme-org") or a full URL.
function orgFromCloudInput(raw: string): string {
  const stripped = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const parts = stripped.split('/').filter(Boolean);
  if (parts.length === 0) return '';
  // A first segment containing a dot is a host (github.com) → org is the next segment.
  return parts[0].includes('.') ? (parts[1] ?? '') : parts[0];
}

const URL_PLACEHOLDERS: Record<string, Record<Deployment, string>> = {
  bitbucket: {
    'cloud': 'https://bitbucket.org/my-workspace',
    'self-hosted': 'https://bitbucket.example.com/my-workspace',
  },
  github: {
    'cloud': 'https://github.com/my-org',
    'self-hosted': 'https://github.example.com/my-org',
  },
  gitlab: {
    'cloud': 'https://gitlab.com/my-group',
    'self-hosted': 'https://gitlab.example.com/my-group',
  },
};

interface SourceFormProps {
  workspaceId: number;
  onConnected: () => void;
  onCancel?: () => void;
}

export function SourceForm({ workspaceId, onConnected, onCancel }: SourceFormProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('single');

  // Single repo URL
  const [singleUrl, setSingleUrl] = useState('');

  // Git Server tab
  const [provider, setProvider] = useState<'bitbucket' | 'github' | 'gitlab'>('github');
  const [deployment, setDeployment] = useState<Deployment>('cloud');
  const [gitServerUrl, setGitServerUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [username, setUsername] = useState('');
  const connectSource = useConnectSource();
  const importFromSource = useImportFromSource();

  // Local upload
  const [file, setFile] = useState<File | null>(null);
  const uploadZip = useUploadRepoZip();

  const [error, setError] = useState('');
  const [rateLimited, setRateLimited] = useState<{ provider: string; url: string } | null>(null);
  const [rateLimitToken, setRateLimitToken] = useState('');

  const isPending = connectSource.isPending || uploadZip.isPending || importFromSource.isPending;

  function handleError(err: Error, sourceUrl?: string) {
    if (err.message === 'RATE_LIMITED' || err.message.includes('RATE_LIMITED')) {
      setRateLimited({ provider: 'github', url: sourceUrl ?? '' });
      setError('');
      return;
    }
    setError(err.message);
  }

  async function retryWithToken() {
    if (!rateLimited || !rateLimitToken.trim()) return;
    setError('');

    // Save token at user level first
    try {
      const res = await apiFetch('/api/auth/provider-token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: rateLimited.provider, token: rateLimitToken.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save token');
    } catch (err: any) {
      setError(err.message);
      return;
    }

    // Retry — backend will now pick up the stored user token automatically
    const normalized = normalizeUrl(rateLimited.url);
    try {
      await connectSource.mutateAsync({ workspace_id: workspaceId, url: normalized });
      await qc.invalidateQueries({ queryKey: ['sources'] });
      onConnected();
      setRateLimited(null);
      setRateLimitToken('');
      setSingleUrl('');
      setUrl('');
    } catch (err: any) {
      handleError(err, normalized);
    }
  }

  async function handleSingleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!singleUrl.trim()) return;
    setError('');
    setRateLimited(null);
    const normalized = normalizeUrl(singleUrl.trim());
    try {
      await connectSource.mutateAsync({ workspace_id: workspaceId, url: normalized });
      await qc.invalidateQueries({ queryKey: ['sources'] });
      onConnected();
      setSingleUrl('');
    } catch (err: any) {
      handleError(err, normalized);
    }
  }

  async function handleGitServerSubmit(e: FormEvent) {
    e.preventDefault();
    if (!gitServerUrl.trim()) return;
    setError('');
    setRateLimited(null);

    let parsedBaseUrl: string;
    let parsedOrgName: string;

    if (deployment === 'cloud') {
      // Cloud: we already know each provider's API host. The input only supplies
      // the org/user/workspace name — accept either a full URL or a bare name.
      parsedBaseUrl = CLOUD_API_BASE[provider];
      parsedOrgName = orgFromCloudInput(gitServerUrl.trim());
    } else {
      // Self-hosted: derive the host from the entered URL.
      let host: string;
      try {
        const u = new URL(normalizeUrl(gitServerUrl.trim()));
        host = `${u.protocol}//${u.host}`;
        parsedOrgName = u.pathname.split('/').filter(Boolean)[0] ?? '';
      } catch {
        setError(t('sources.invalidGitServerUrl'));
        return;
      }
      // GitHub Enterprise serves its REST API under /api/v3; GitLab/Bitbucket use the host as-is.
      parsedBaseUrl = provider === 'github' ? `${host}/api/v3` : host;
    }

    try {
      await connectSource.mutateAsync({
        workspace_id: workspaceId,
        provider,
        base_url: parsedBaseUrl,
        org_name: parsedOrgName || undefined,
        access_token: accessToken.trim() || undefined,
        username: provider === 'bitbucket' ? username.trim() || undefined : undefined,
      } as any);
      await qc.invalidateQueries({ queryKey: ['sources'] });
      onConnected();
      setProvider('github');
      setDeployment('cloud');
      setGitServerUrl('');
      setAccessToken('');
      setUsername('');
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleLocalSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError('');
    try {
      await uploadZip.mutateAsync({ workspaceId, file });
      await qc.invalidateQueries({ queryKey: ['sources'] });
      onConnected();
      setFile(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'single', label: t('sources.singleRepo') },
    { key: 'git-server', label: t('sources.gitServer') },
    { key: 'local', label: t('repos.addRepoUpload') },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-th-border mb-5">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setError(''); setRateLimited(null); }}
            className={cn(
              'beast-tab',
              tab === key && 'beast-tab-active',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="beast-error mb-4">
          {error}
        </div>
      )}

      {rateLimited && (
        <div className="border border-beast-red/30 bg-beast-red/5 p-4 mb-4 space-y-3">
          <p className="text-sm text-th-text">
            GitHub API rate limit exceeded. Provide a personal access token to continue.
          </p>
          <div>
            <input
              type="text"
              autoComplete="off"
              style={{ WebkitTextSecurity: 'disc' } as any}
              className="beast-input beast-input-sm"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={rateLimitToken}
              onChange={(e) => setRateLimitToken(e.target.value)}
            />
            <a
              href="https://github.com/settings/tokens/new?description=BEAST"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-[11px] text-th-text-muted hover:text-beast-red"
            >
              Where do I get this token?
            </a>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={retryWithToken}
              disabled={!rateLimitToken.trim() || isPending}
              className="beast-btn beast-btn-primary beast-btn-sm"
            >
              {isPending ? 'Connecting...' : 'Retry with token'}
            </button>
            <button
              type="button"
              onClick={() => { setRateLimited(null); setRateLimitToken(''); }}
              className="beast-btn beast-btn-ghost beast-btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Single repo tab */}
      {tab === 'single' && (
        <form onSubmit={handleSingleSubmit} className="space-y-4">
          <div>
            <label htmlFor="single-repo-url" className="beast-label">{t('sources.pasteRepoUrl')}</label>
            <input
              id="single-repo-url"
              type="text"
              className="beast-input"
              placeholder="github.com/org/repo"
              value={singleUrl}
              onChange={(e) => setSingleUrl(e.target.value)}
              required
            />
            <ProviderHint />
          </div>
          <div className="flex gap-2 justify-end">
            {onCancel && (
              <button type="button" onClick={onCancel} className="beast-btn beast-btn-outline">
                {t('common.cancel')}
              </button>
            )}
            <button type="submit" disabled={isPending || !singleUrl.trim()} className="beast-btn beast-btn-primary">
              {isPending ? t('sources.addingRepo') : t('sources.addSource')}
            </button>
          </div>
        </form>
      )}

      {/* Git Server tab */}
      {tab === 'git-server' && (
        <form onSubmit={handleGitServerSubmit} className="space-y-4">
          <div>
            <label htmlFor="git-provider" className="beast-label">{t('settings.provider')}</label>
            <select
              id="git-provider"
              className="beast-input"
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
            >
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              <option value="bitbucket">Bitbucket</option>
            </select>
          </div>
          <div>
            <label htmlFor="git-deployment" className="beast-label">{t('settings.deployment')}</label>
            <select
              id="git-deployment"
              className="beast-input"
              value={deployment}
              onChange={(e) => setDeployment(e.target.value as Deployment)}
            >
              <option value="cloud">{t('settings.deploymentCloud')}</option>
              <option value="self-hosted">{t('settings.deploymentSelfHosted')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="git-server-url" className="beast-label">{t('settings.gitServerUrl')}</label>
            <input
              id="git-server-url"
              name="source-git-server-url"
              type="text"
              autoComplete="off"
              className="beast-input"
              placeholder={URL_PLACEHOLDERS[provider][deployment]}
              value={gitServerUrl}
              onChange={(e) => setGitServerUrl(e.target.value)}
              required
            />
          </div>

          <div className="beast-form-section">
            <h3 className="beast-card-title">{t('sources.tokenSectionTitle')}</h3>
            <p className="beast-text-hint">{t('sources.tokenSectionDesc')}</p>
            <div>
              <label htmlFor="access-token" className="beast-label">{t('settings.accessToken')}</label>
              <input
                id="access-token"
                name="source-access-token"
                type="text"
                autoComplete="off"
                className="beast-input"
                style={{ WebkitTextSecurity: 'disc' } as any}
                placeholder={TOKEN_PLACEHOLDERS[provider]}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>
            {provider === 'bitbucket' && (
              <div>
                <label htmlFor="bb-username" className="beast-label">{t('settings.bbUsername')}</label>
                <input
                  id="bb-username"
                  type="text"
                  className="beast-input"
                  placeholder="username (for API token auth)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            {onCancel && (
              <button type="button" onClick={onCancel} className="beast-btn beast-btn-outline">
                {t('common.cancel')}
              </button>
            )}
            <button type="submit" disabled={isPending || !gitServerUrl.trim()} className="beast-btn beast-btn-primary">
              {isPending ? t('sources.connecting') : t('sources.addSource')}
            </button>
          </div>
        </form>
      )}

      {/* Local upload tab */}
      {tab === 'local' && (
        <form onSubmit={handleLocalSubmit} className="space-y-4">
          <div>
            <label className="beast-label">{t('repos.uploadZip')}</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-th-border bg-th-bg p-8 cursor-pointer hover:border-beast-red transition-colors">
              <svg className="w-8 h-8 text-th-text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="text-sm text-th-text-muted">{file ? file.name : t('repos.dropZipHere')}</span>
              <input
                type="file"
                accept=".zip,.tar,.tar.gz,.tgz"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            {onCancel && (
              <button type="button" onClick={onCancel} className="beast-btn beast-btn-outline">
                {t('common.cancel')}
              </button>
            )}
            <button type="submit" disabled={isPending || !file} className="beast-btn beast-btn-primary">
              {isPending ? t('repos.uploading') : t('repos.addButton')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
