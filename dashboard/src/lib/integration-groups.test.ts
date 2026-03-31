import { describe, it, expect } from 'vitest';
import { buildIntegrationGroups, toolCategoryColors, snykLabels } from './integration-groups';
import type { ToolDefinition } from '@/api/types';

function makeTool(overrides: Partial<ToolDefinition> & { key: string }): ToolDefinition {
  return {
    displayName: overrides.key,
    description: 'test',
    category: 'secrets',
    website: 'https://example.com',
    credentials: [],
    recommended: false,
    pricing: 'free',
    runnerKey: overrides.key,
    ...overrides,
  };
}

describe('buildIntegrationGroups', () => {
  it('returns empty array when no tools need credentials', () => {
    const tools = [makeTool({ key: 'gitleaks' })];
    const enabled = { gitleaks: true };
    expect(buildIntegrationGroups(tools, enabled)).toEqual([]);
  });

  it('returns empty array when tools with credentials are disabled', () => {
    const tools = [makeTool({
      key: 'gitguardian',
      credentials: [{ envVar: 'GG_TOKEN', label: 'Token', placeholder: '', helpUrl: '', vaultLabel: 'gitguardian' }],
    })];
    const enabled = { gitguardian: false };
    expect(buildIntegrationGroups(tools, enabled)).toEqual([]);
  });

  it('creates a group for an enabled tool with credentials', () => {
    const tools = [makeTool({
      key: 'gitguardian',
      displayName: 'GitGuardian',
      credentials: [{ envVar: 'GG_TOKEN', label: 'Token', placeholder: '', helpUrl: '', vaultLabel: 'gitguardian' }],
    })];
    const enabled = { gitguardian: true };
    const groups = buildIntegrationGroups(tools, enabled);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe('gitguardian');
    expect(groups[0].name).toBe('GitGuardian');
    expect(groups[0].validatorToolKey).toBe('gitguardian');
  });

  it('merges snyk tools into a single group', () => {
    const cred = { envVar: 'SNYK_TOKEN', label: 'Token', placeholder: '', helpUrl: '', vaultLabel: 'snyk' };
    const tools = [
      makeTool({ key: 'snyk-code', displayName: 'Snyk Code', category: 'sast', credentials: [cred] }),
      makeTool({ key: 'snyk-sca', displayName: 'Snyk SCA', category: 'sca', credentials: [cred] }),
      makeTool({ key: 'snyk-iac', displayName: 'Snyk IaC', category: 'iac', credentials: [cred] }),
    ];
    const enabled = { 'snyk-code': true, 'snyk-sca': true, 'snyk-iac': true };
    const groups = buildIntegrationGroups(tools, enabled);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Snyk');
    expect(groups[0].usedBy).toEqual(['Code', 'SCA', 'IaC']);
  });

  it('only includes enabled tools in groups', () => {
    const cred = { envVar: 'SNYK_TOKEN', label: 'Token', placeholder: '', helpUrl: '', vaultLabel: 'snyk' };
    const tools = [
      makeTool({ key: 'snyk-code', displayName: 'Snyk Code', category: 'sast', credentials: [cred] }),
      makeTool({ key: 'snyk-sca', displayName: 'Snyk SCA', category: 'sca', credentials: [cred] }),
    ];
    const enabled = { 'snyk-code': true, 'snyk-sca': false };
    const groups = buildIntegrationGroups(tools, enabled);
    expect(groups).toHaveLength(1);
    expect(groups[0].usedBy).toEqual(['Code']);
  });
});

describe('toolCategoryColors', () => {
  it('has colors for known categories', () => {
    expect(toolCategoryColors.secrets).toBe('bg-purple-600');
    expect(toolCategoryColors.sast).toBe('bg-blue-600');
    expect(toolCategoryColors.sca).toBe('bg-emerald-600');
    expect(toolCategoryColors.iac).toBe('bg-amber-600');
  });
});

describe('snykLabels', () => {
  it('maps snyk tool keys to short labels', () => {
    expect(snykLabels['snyk-code']).toBe('Code');
    expect(snykLabels['snyk-sca']).toBe('SCA');
    expect(snykLabels['snyk-iac']).toBe('IaC');
  });
});
