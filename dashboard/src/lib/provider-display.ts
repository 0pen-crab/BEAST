export const PROVIDER_DISPLAY: Record<string, { label: string; color: string }> = {
  github: { label: 'GitHub', color: 'text-th-text' },
  gitlab: { label: 'GitLab', color: 'text-beast-red-light' },
  bitbucket: { label: 'Bitbucket', color: 'text-blue-400' },
  local: { label: 'Local', color: 'text-th-text-muted' },
};

/** Bare hostname from a base URL: "https://gitlab.example.com/api/v4" → "gitlab.example.com". */
function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0];
  }
}

/**
 * Human label for a source in filters/lists.
 *  - org/group sources (cloud or self-hosted with a group) → the org/group name
 *  - self-hosted server-wide (no orgName) → the cleaned server host
 *  - local uploads / unparseable → the provider display label
 */
export function sourceDisplayLabel(source: { provider: string; baseUrl: string; orgName: string | null }): string {
  if (source.orgName) return source.orgName;
  if (source.provider !== 'local') {
    const host = hostFromBaseUrl(source.baseUrl);
    if (host) return host;
  }
  return PROVIDER_DISPLAY[source.provider]?.label ?? source.provider;
}
