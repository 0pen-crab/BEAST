/** Maps tool keys to their icon paths in /public/tools/ */
export const TOOL_ICONS: Record<string, string> = {
  beast: '/favicon-96x96.png',
  gitleaks: '/tools/gitleaks.png',
  trufflehog: '/tools/trufflehog.png',
  trivy: '/tools/trivy.png',
  'trivy-secrets': '/tools/trivy.png',
  'trivy-sca': '/tools/trivy.png',
  'trivy-iac': '/tools/trivy.png',
  gitguardian: '/tools/gitguardian.png',
  semgrep: '/tools/semgrep.png',
  checkov: '/tools/checkov.png',
  'snyk-code': '/tools/snyk.png',
  'snyk-sca': '/tools/snyk.png',
  'snyk-iac': '/tools/snyk.png',
  'osv-scanner': '/tools/osv.png',
  jfrog: '/tools/jfrog.png',
  bearer: '/tools/bearer.png',
  presidio: '/tools/presidio.png',
  'semgrep-pii': '/tools/semgrep.png',
};

/** Override colors for tools without icons (fallback letter avatar) */
export const TOOL_ICON_COLORS: Record<string, string> = {};

export function getToolIcon(key: string): string | undefined {
  return TOOL_ICONS[key];
}

export function getToolIconColor(key: string, defaultColor: string): string {
  return TOOL_ICON_COLORS[key] ?? defaultColor;
}
