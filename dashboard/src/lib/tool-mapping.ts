import type { ToolCategory } from '@/api/types';

export interface ToolInfo {
  key: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  iconBg: string;
  lightBg: string;
}

export interface CategoryInfo {
  key: ToolCategory;
  displayName: string;
  description: string;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  icon: string;
}

export const TOOL_CATEGORIES: CategoryInfo[] = [
  {
    key: 'sast',
    displayName: 'Code Analysis',
    description: 'Static analysis and AI-powered code review',
    color: '#2563eb',
    bgClass: 'bg-blue-600',
    textClass: 'text-blue-400',
    borderClass: 'border-blue-800/40',
    icon: '🔍',
  },
  {
    key: 'sca',
    displayName: 'Dependencies',
    description: 'Open source and third-party dependency scanning',
    color: '#d97706',
    bgClass: 'bg-amber-600',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-800/40',
    icon: '📦',
  },
  {
    key: 'iac',
    displayName: 'Infrastructure',
    description: 'Infrastructure as code misconfiguration detection',
    color: '#9333ea',
    bgClass: 'bg-purple-600',
    textClass: 'text-purple-400',
    borderClass: 'border-purple-800/40',
    icon: '🏗',
  },
  {
    key: 'secrets',
    displayName: 'Secrets',
    description: 'Credential and secret detection in code and history',
    color: '#0891b2',
    bgClass: 'bg-cyan-600',
    textClass: 'text-cyan-400',
    borderClass: 'border-cyan-800/40',
    icon: '🔑',
  },
  {
    key: 'pii',
    displayName: 'Personal Data',
    description: 'Detect exposed personal information in source code',
    color: '#e11d48',
    bgClass: 'bg-rose-600',
    textClass: 'text-rose-400',
    borderClass: 'border-rose-800/40',
    icon: '👤',
  },
];

export const TOOLS: ToolInfo[] = [
  {
    key: 'beast',
    displayName: 'BEAST',
    description: 'AI-powered code analysis',
    category: 'sast',
    color: '#ea580c',
    bgClass: 'bg-orange-600',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-200',
    iconBg: 'bg-orange-100',
    lightBg: 'bg-orange-50',
  },
  {
    key: 'gitleaks',
    displayName: 'Gitleaks',
    description: 'Secret detection in git history',
    category: 'secrets',
    color: '#0891b2',
    bgClass: 'bg-cyan-600',
    textClass: 'text-cyan-700',
    borderClass: 'border-cyan-200',
    iconBg: 'bg-cyan-100',
    lightBg: 'bg-cyan-50',
  },
  {
    key: 'trufflehog',
    displayName: 'Trufflehog',
    description: 'Credential & secret scanning',
    category: 'secrets',
    color: '#7c3aed',
    bgClass: 'bg-violet-600',
    textClass: 'text-violet-700',
    borderClass: 'border-violet-200',
    iconBg: 'bg-violet-100',
    lightBg: 'bg-violet-50',
  },
  {
    key: 'snyk-sca',
    displayName: 'Snyk',
    description: 'Open source dependency vulnerability scanning (SCA)',
    category: 'sca',
    color: '#4338ca',
    bgClass: 'bg-indigo-600',
    textClass: 'text-indigo-700',
    borderClass: 'border-indigo-200',
    iconBg: 'bg-indigo-100',
    lightBg: 'bg-indigo-50',
  },
  {
    key: 'osv-scanner',
    displayName: 'OSV-Scanner',
    description: 'Open source vulnerability scanning (SCA)',
    category: 'sca',
    color: '#16a34a',
    bgClass: 'bg-green-600',
    textClass: 'text-green-700',
    borderClass: 'border-green-200',
    iconBg: 'bg-green-100',
    lightBg: 'bg-green-50',
  },
  {
    key: 'jfrog',
    displayName: 'JFrog Xray',
    description: 'Software composition analysis (SCA)',
    category: 'sca',
    color: '#d97706',
    bgClass: 'bg-amber-600',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
    iconBg: 'bg-amber-100',
    lightBg: 'bg-amber-50',
  },
  {
    key: 'semgrep',
    displayName: 'Semgrep',
    description: 'Static application security testing (SAST)',
    category: 'sast',
    color: '#2563eb',
    bgClass: 'bg-blue-600',
    textClass: 'text-blue-700',
    borderClass: 'border-blue-200',
    iconBg: 'bg-blue-100',
    lightBg: 'bg-blue-50',
  },
  {
    key: 'checkov',
    displayName: 'Checkov',
    description: 'Infrastructure as code security scanning (IaC)',
    category: 'iac',
    color: '#9333ea',
    bgClass: 'bg-purple-600',
    textClass: 'text-purple-700',
    borderClass: 'border-purple-200',
    iconBg: 'bg-purple-100',
    lightBg: 'bg-purple-50',
  },
  {
    key: 'gitguardian',
    displayName: 'GitGuardian',
    description: 'Secret detection and data leakage prevention',
    category: 'secrets',
    color: '#db2777',
    bgClass: 'bg-pink-600',
    textClass: 'text-pink-700',
    borderClass: 'border-pink-200',
    iconBg: 'bg-pink-100',
    lightBg: 'bg-pink-50',
  },
  {
    key: 'snyk-code',
    displayName: 'Snyk Code',
    description: 'Static application security testing (SAST)',
    category: 'sast',
    color: '#4f46e5',
    bgClass: 'bg-indigo-600',
    textClass: 'text-indigo-700',
    borderClass: 'border-indigo-200',
    iconBg: 'bg-indigo-100',
    lightBg: 'bg-indigo-50',
  },
  {
    key: 'snyk-iac',
    displayName: 'Snyk IaC',
    description: 'Infrastructure as code security scanning (IaC)',
    category: 'iac',
    color: '#6d28d9',
    bgClass: 'bg-violet-700',
    textClass: 'text-violet-800',
    borderClass: 'border-violet-300',
    iconBg: 'bg-violet-100',
    lightBg: 'bg-violet-50',
  },
  {
    key: 'trivy-secrets',
    displayName: 'Trivy',
    description: 'Secret detection in source code and configs',
    category: 'secrets',
    color: '#0d9488',
    bgClass: 'bg-teal-600',
    textClass: 'text-teal-700',
    borderClass: 'border-teal-200',
    iconBg: 'bg-teal-100',
    lightBg: 'bg-teal-50',
  },
  {
    key: 'trivy-sca',
    displayName: 'Trivy SCA',
    description: 'Software composition analysis for dependencies',
    category: 'sca',
    color: '#047857',
    bgClass: 'bg-emerald-700',
    textClass: 'text-emerald-800',
    borderClass: 'border-emerald-300',
    iconBg: 'bg-emerald-100',
    lightBg: 'bg-emerald-50',
  },
  {
    key: 'trivy-iac',
    displayName: 'Trivy IaC',
    description: 'Infrastructure as code misconfiguration scanning',
    category: 'iac',
    color: '#15803d',
    bgClass: 'bg-green-700',
    textClass: 'text-green-800',
    borderClass: 'border-green-300',
    iconBg: 'bg-green-100',
    lightBg: 'bg-green-50',
  },
  {
    key: 'bearer',
    displayName: 'Bearer',
    description: 'Sensitive data flow detection in source code (PII)',
    category: 'pii',
    color: '#e11d48',
    bgClass: 'bg-rose-600',
    textClass: 'text-rose-700',
    borderClass: 'border-rose-200',
    iconBg: 'bg-rose-100',
    lightBg: 'bg-rose-50',
  },
  {
    key: 'presidio',
    displayName: 'Presidio',
    description: 'NLP-powered personal data detection (PII)',
    category: 'pii',
    color: '#be123c',
    bgClass: 'bg-rose-700',
    textClass: 'text-rose-800',
    borderClass: 'border-rose-300',
    iconBg: 'bg-rose-100',
    lightBg: 'bg-rose-50',
  },
  {
    key: 'semgrep-pii',
    displayName: 'Semgrep PII',
    description: 'PII detection rules for personal data exposure',
    category: 'pii',
    color: '#f43f5e',
    bgClass: 'bg-rose-500',
    textClass: 'text-rose-600',
    borderClass: 'border-rose-200',
    iconBg: 'bg-rose-100',
    lightBg: 'bg-rose-50',
  },
];

export function resolveToolFromTest(toolKey: string): ToolInfo | undefined {
  return TOOLS.find((t) => t.key === toolKey);
}

export function getToolByKey(key: string): ToolInfo | undefined {
  return TOOLS.find((t) => t.key === key);
}

export function getToolsByCategory(category: ToolCategory): ToolInfo[] {
  return TOOLS.filter((t) => t.category === category);
}

export function getCategoryByKey(key: ToolCategory): CategoryInfo | undefined {
  return TOOL_CATEGORIES.find((c) => c.key === key);
}
