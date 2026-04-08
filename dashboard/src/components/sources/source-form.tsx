import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useConnectSource, useImportFromSource, useUploadRepoZip } from '@/api/hooks';
import { apiFetch } from '@/api/client';
import { cn } from '@/lib/utils';

type Tab = 'single' | 'public' | 'private' | 'local';

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

  // Public URL
  const [url, setUrl] = useState('');

  // Private source
  const [provider, setProvider] = useState('bitbucket');
  const [orgName, setOrgName] = useState('');
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

  async function handlePublicSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError('');
    setRateLimited(null);
    const normalized = normalizeUrl(url.trim());
    try {
      await connectSource.mutateAsync({ workspace_id: workspaceId, url: normalized });
      await qc.invalidateQueries({ queryKey: ['sources'] });
      onConnected();
      setUrl('');
    } catch (err: any) {
      handleError(err, normalized);
    }
  }

  async function handlePrivateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken.trim()) return;
    setError('');

    const baseUrls: Record<string, string> = {
      bitbucket: 'https://api.bitbucket.org/2.0',
      github: 'https://api.github.com',
      gitlab: 'https://gitlab.com',
    };

    try {
      await connectSource.mutateAsync({
        workspace_id: workspaceId,
        provider,
        base_url: baseUrls[provider] || baseUrls.bitbucket,
        org_name: orgName.trim() || undefined,
        access_token: accessToken.trim(),
        username: provider === 'bitbucket' ? username.trim() || undefined : undefined,
      });
      await qc.invalidateQueries({ queryKey: ['sources'] });
      onConnected();
      setProvider('bitbucket');
      setOrgName('');
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
    { key: 'public', label: t('sources.publicSource') },
    { key: 'private', label: t('sources.privateSource') },
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

      {/* Public URL tab */}
      {tab === 'public' && (
        <form onSubmit={handlePublicSubmit} className="space-y-4">
          <div>
            <label htmlFor="source-url" className="beast-label">{t('sources.pasteSourceUrl')}</label>
            <input
              id="source-url"
              type="text"
              className="beast-input"
              placeholder="github.com/org-or-username"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
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
            <button type="submit" disabled={isPending || !url.trim()} className="beast-btn beast-btn-primary">
              {isPending ? t('repos.uploading') : t('repos.addButton')}
            </button>
          </div>
        </form>
      )}

      {/* Private source tab */}
      {tab === 'private' && (
        <form onSubmit={handlePrivateSubmit} className="space-y-4">
          <div>
            <label htmlFor="provider" className="beast-label">{t('settings.provider')}</label>
            <select
              id="provider"
              className="beast-input"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="bitbucket">Bitbucket</option>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
          </div>
          <div>
            <label htmlFor="org-name" className="beast-label">{t('settings.orgName')}</label>
            <input
              id="org-name"
              name="source-org-name"
              type="text"
              autoComplete="off"
              className="beast-input"
              placeholder="my-organization"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="access-token" className="beast-label">{t('settings.accessToken')}</label>
            <input
              id="access-token"
              name="source-access-token"
              type="text"
              autoComplete="off"
              className="beast-input"
              style={{ WebkitTextSecurity: 'disc' } as any}
              placeholder="ghp_... or ATBB..."
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              required
            />
            {provider === 'github' && (
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=BEAST"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[11px] text-th-text-muted hover:text-beast-red"
              >
                Where do I get the token?
              </a>
            )}
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
          <div className="flex gap-2 justify-end">
            {onCancel && (
              <button type="button" onClick={onCancel} className="beast-btn beast-btn-outline">
                {t('common.cancel')}
              </button>
            )}
            <button type="submit" disabled={isPending || !accessToken.trim()} className="beast-btn beast-btn-primary">
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
