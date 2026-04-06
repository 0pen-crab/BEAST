import { getToolIcon } from '@/lib/tool-icons';
import type { ToolDefinition, CredentialField } from '@/api/types';

export interface IntegrationGroup {
  groupKey: string;
  name: string;
  iconLetter: string;
  iconColor: string;
  iconUrl?: string;
  credentials: CredentialField[];
  usedBy: string[];
  validatorToolKey: string;
}

export const toolCategoryColors: Record<string, string> = {
  secrets: 'bg-purple-600',
  sast: 'bg-blue-600',
  sca: 'bg-emerald-600',
  iac: 'bg-amber-600',
  pii: 'bg-rose-600',
};

export const snykLabels: Record<string, string> = {
  'snyk-code': 'Code',
  'snyk-sca': 'SCA',
  'snyk-iac': 'IaC',
};

export function buildIntegrationGroups(
  tools: ToolDefinition[],
  enabled: Record<string, boolean>,
): IntegrationGroup[] {
  const groups = new Map<string, IntegrationGroup>();

  for (const tool of tools) {
    if (!enabled[tool.key] || tool.credentials.length === 0) continue;

    const groupKey = tool.credentials[0].vaultLabel;

    if (groups.has(groupKey)) {
      const existing = groups.get(groupKey)!;
      existing.usedBy.push(snykLabels[tool.key] ?? tool.displayName);
    } else {
      const isSnyk = tool.key.startsWith('snyk-');
      groups.set(groupKey, {
        groupKey,
        name: isSnyk ? 'Snyk' : tool.displayName,
        iconLetter: isSnyk ? 'S' : tool.displayName[0],
        iconColor: toolCategoryColors[tool.category] ?? 'bg-gray-600',
        iconUrl: getToolIcon(isSnyk ? 'snyk-code' : tool.key),
        credentials: tool.credentials,
        usedBy: [snykLabels[tool.key] ?? tool.displayName],
        validatorToolKey: tool.key,
      });
    }
  }

  return Array.from(groups.values());
}
