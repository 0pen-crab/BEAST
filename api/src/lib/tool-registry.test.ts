import { describe, it, expect } from 'vitest';
import { TOOL_REGISTRY, TOOL_CATEGORIES, type ToolDefinition } from './tool-registry.ts';

describe('tool-registry', () => {
  it('has no duplicate tool keys', () => {
    const keys = TOOL_REGISTRY.map(t => t.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('all tools have valid categories', () => {
    const validCategories = Object.keys(TOOL_CATEGORIES);
    for (const tool of TOOL_REGISTRY) {
      expect(validCategories).toContain(tool.category);
    }
  });

  it('all tools have valid pricing', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(['free', 'free_tier', 'paid']).toContain(tool.pricing);
    }
  });

  it('free tools have no credential fields', () => {
    for (const tool of TOOL_REGISTRY.filter(t => t.pricing === 'free')) {
      expect(tool.credentials).toHaveLength(0);
    }
  });

  it('non-free tools have at least one credential field', () => {
    for (const tool of TOOL_REGISTRY.filter(t => t.pricing !== 'free')) {
      expect(tool.credentials.length).toBeGreaterThan(0);
    }
  });

  it('contains exactly 13 tool entries', () => {
    expect(TOOL_REGISTRY).toHaveLength(13);
  });

  it('has 4 categories', () => {
    expect(Object.keys(TOOL_CATEGORIES)).toHaveLength(4);
  });

  it('all credential fields have vaultLabel', () => {
    for (const tool of TOOL_REGISTRY) {
      for (const cred of tool.credentials) {
        expect(cred.vaultLabel).toBeTruthy();
      }
    }
  });

  it('snyk tools share the same credential vaultLabel', () => {
    const snykTools = TOOL_REGISTRY.filter(t => t.runnerKey === 'snyk');
    expect(snykTools).toHaveLength(3);
    const labels = snykTools.flatMap(t => t.credentials.map(c => c.vaultLabel));
    expect(new Set(labels).size).toBe(1);
  });

  it('trivy tools share the same runnerKey', () => {
    const trivyTools = TOOL_REGISTRY.filter(t => t.runnerKey === 'trivy');
    expect(trivyTools).toHaveLength(3);
    for (const t of trivyTools) {
      expect(t.runnerArgs?.scanners).toBeTruthy();
    }
  });
});
