export type ToolCategory = 'secrets' | 'sast' | 'sca' | 'iac';

export type ToolPricing = 'free' | 'free_tier' | 'paid';

export interface CredentialField {
  envVar: string;
  label: string;
  placeholder: string;
  helpUrl: string;
  required: boolean;
  vaultLabel: string;
}

export interface ToolDefinition {
  key: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  website: string;
  credentials: CredentialField[];
  recommended: boolean;
  pricing: ToolPricing;
  runnerKey: string;
  runnerArgs?: Record<string, string>;
}

export const TOOL_CATEGORIES: Record<ToolCategory, { label: string; description: string }> = {
  secrets: {
    label: 'Secret Detection',
    description: 'Scan for leaked credentials, API keys, and tokens in source code and git history.',
  },
  sast: {
    label: 'Static Analysis (SAST)',
    description: 'Detect bugs, vulnerabilities, and anti-patterns through static code analysis.',
  },
  sca: {
    label: 'Software Composition Analysis (SCA)',
    description: 'Identify known vulnerabilities in open-source dependencies and libraries.',
  },
  iac: {
    label: 'Infrastructure as Code (IaC)',
    description: 'Scan Terraform, CloudFormation, Dockerfiles, and Kubernetes manifests for misconfigurations.',
  },
};

const snykCredential: CredentialField = {
  envVar: 'SNYK_TOKEN',
  label: 'Snyk API Token',
  placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  helpUrl: 'https://docs.snyk.io/snyk-api/authentication-for-api/personal-access-tokens-pats',
  required: true,
  vaultLabel: 'snyk_token',
};

export const TOOL_REGISTRY: ToolDefinition[] = [
  // ── Secrets ──
  {
    key: 'gitleaks',
    displayName: 'Gitleaks',
    description: 'Detect hardcoded secrets in git repos using regex and entropy analysis.',
    category: 'secrets',
    website: 'https://gitleaks.io',
    credentials: [],
    recommended: true,
    pricing: 'free',
    runnerKey: 'gitleaks',
  },
  {
    key: 'trufflehog',
    displayName: 'Trufflehog',
    description: 'Find and verify leaked credentials across git history and code.',
    category: 'secrets',
    website: 'https://trufflesecurity.com/trufflehog',
    credentials: [],
    recommended: true,
    pricing: 'free',
    runnerKey: 'trufflehog',
  },
  {
    key: 'trivy-secrets',
    displayName: 'Trivy',
    description: 'Detect secrets embedded in source code and configuration files.',
    category: 'secrets',
    website: 'https://trivy.dev',
    credentials: [],
    recommended: true,
    pricing: 'free',
    runnerKey: 'trivy',
    runnerArgs: { scanners: 'secret' },
  },
  {
    key: 'gitguardian',
    displayName: 'GitGuardian',
    description: 'Detect and remediate secrets sprawl with policy-based scanning.',
    category: 'secrets',
    website: 'https://www.gitguardian.com',
    credentials: [
      {
        envVar: 'GITGUARDIAN_API_KEY',
        label: 'GitGuardian API Key',
        placeholder: 'AB9eLkK21bcAXXXXXXXXXXXXXXXXXXXXXXX',
        helpUrl: 'https://docs.gitguardian.com/api-docs/personal-access-tokens',
        required: true,
        vaultLabel: 'gitguardian_api_key',
      },
    ],
    recommended: false,
    pricing: 'free_tier',
    runnerKey: 'gitguardian',
  },

  // ── SAST ──
  {
    key: 'semgrep',
    displayName: 'Semgrep',
    description: 'Lightweight static analysis with community-driven rules for many languages.',
    category: 'sast',
    website: 'https://semgrep.dev',
    credentials: [],
    recommended: true,
    pricing: 'free',
    runnerKey: 'semgrep',
  },
  {
    key: 'snyk-code',
    displayName: 'Snyk Code',
    description: 'AI-powered SAST that detects security vulnerabilities in your code.',
    category: 'sast',
    website: 'https://snyk.io/product/snyk-code',
    credentials: [snykCredential],
    recommended: false,
    pricing: 'free_tier',
    runnerKey: 'snyk',
    runnerArgs: { mode: 'code test' },
  },

  // ── SCA ──
  {
    key: 'osv-scanner',
    displayName: 'OSV-Scanner',
    description: 'Scan dependencies against the OSV vulnerability database.',
    category: 'sca',
    website: 'https://osv.dev',
    credentials: [],
    recommended: true,
    pricing: 'free',
    runnerKey: 'osv-scanner',
  },
  {
    key: 'trivy-sca',
    displayName: 'Trivy',
    description: 'Find known vulnerabilities in OS packages and language dependencies.',
    category: 'sca',
    website: 'https://trivy.dev',
    credentials: [],
    recommended: true,
    pricing: 'free',
    runnerKey: 'trivy',
    runnerArgs: { scanners: 'vuln' },
  },
  {
    key: 'snyk-sca',
    displayName: 'Snyk',
    description: 'Identify and fix vulnerabilities in open-source dependencies.',
    category: 'sca',
    website: 'https://snyk.io/product/open-source-security',
    credentials: [snykCredential],
    recommended: false,
    pricing: 'free_tier',
    runnerKey: 'snyk',
    runnerArgs: { mode: 'test' },
  },
  {
    key: 'jfrog',
    displayName: 'JFrog Xray',
    description: 'Deep recursive scanning for vulnerabilities in binary artifacts and dependencies.',
    category: 'sca',
    website: 'https://jfrog.com/xray',
    credentials: [
      {
        envVar: 'JF_URL',
        label: 'Base URL',
        placeholder: 'https://your-instance.jfrog.io',
        helpUrl: 'https://docs.jfrog.com/installation/docs/onboarding-wizard#step-4-set-base-url',
        required: true,
        vaultLabel: 'jfrog_url',
      },
      {
        envVar: 'JF_ACCESS_TOKEN',
        label: 'JFrog Access Token',
        placeholder: 'eyJ...',
        helpUrl: 'https://docs.jfrog.com/administration/docs/access-tokens',
        required: true,
        vaultLabel: 'jfrog_access_token',
      },
    ],
    recommended: false,
    pricing: 'free_tier',
    runnerKey: 'jfrog',
  },

  // ── IaC ──
  {
    key: 'checkov',
    displayName: 'Checkov',
    description: 'Scan IaC files for misconfigurations across Terraform, CloudFormation, and more.',
    category: 'iac',
    website: 'https://www.checkov.io',
    credentials: [],
    recommended: true,
    pricing: 'free',
    runnerKey: 'checkov',
  },
  {
    key: 'trivy-iac',
    displayName: 'Trivy',
    description: 'Detect misconfigurations in Dockerfiles, Kubernetes, and Terraform.',
    category: 'iac',
    website: 'https://trivy.dev',
    credentials: [],
    recommended: true,
    pricing: 'free',
    runnerKey: 'trivy',
    runnerArgs: { scanners: 'misconfig' },
  },
  {
    key: 'snyk-iac',
    displayName: 'Snyk IaC',
    description: 'Find and fix misconfigurations in Terraform, Kubernetes, and ARM templates.',
    category: 'iac',
    website: 'https://snyk.io/product/infrastructure-as-code-security',
    credentials: [snykCredential],
    recommended: false,
    pricing: 'free_tier',
    runnerKey: 'snyk',
    runnerArgs: { mode: 'iac test' },
  },
];

export function getToolByKey(key: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.key === key);
}

export function getAllToolKeys(): string[] {
  return TOOL_REGISTRY.map((t) => t.key);
}

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return TOOL_REGISTRY.filter((t) => t.category === category);
}

export function getRecommendedToolKeys(): string[] {
  return TOOL_REGISTRY.filter((t) => t.recommended).map((t) => t.key);
}
