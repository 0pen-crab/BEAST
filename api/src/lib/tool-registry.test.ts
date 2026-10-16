import { describe, it, expect } from 'vitest';
import {
  TOOL_REGISTRY,
  TOOL_CATEGORIES,
  getToolByKey,
  getAllToolKeys,
  getToolsByCategory,
  getRecommendedToolKeys,
} from './tool-registry.ts';

describe('tool-registry', () => {
  it('has pii category defined', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('pii');
    expect(TOOL_CATEGORIES.pii.label).toBe('Personal Data (PII)');
  });

  it('has all 5 categories', () => {
    const keys = Object.keys(TOOL_CATEGORIES);
    expect(keys).toContain('secrets');
    expect(keys).toContain('sast');
    expect(keys).toContain('sca');
    expect(keys).toContain('iac');
    expect(keys).toContain('pii');
  });

  it('getToolsByCategory("pii") returns 2 tools', () => {
    const piiTools = getToolsByCategory('pii');
    expect(piiTools).toHaveLength(2);
    const keys = piiTools.map(t => t.key);
    expect(keys).toContain('presidio');
    expect(keys).toContain('semgrep-pii');
  });

  it('getAllToolKeys includes PII tool keys', () => {
    const keys = getAllToolKeys();
    expect(keys).toContain('presidio');
    expect(keys).toContain('semgrep-pii');
  });

  it('getToolByKey returns correct PII tool definitions', () => {
    const presidio = getToolByKey('presidio');
    expect(presidio).toBeDefined();
    expect(presidio!.category).toBe('pii');

    const semgrepPii = getToolByKey('semgrep-pii');
    expect(semgrepPii).toBeDefined();
    expect(semgrepPii!.category).toBe('pii');
    expect(semgrepPii!.runnerArgs).toEqual({ config: 'p/pii' });
  });

  it('PII tools are NOT recommended (off by default — opt-in compliance feature)', () => {
    const recommended = getRecommendedToolKeys();
    expect(recommended).not.toContain('presidio');
    expect(recommended).not.toContain('semgrep-pii');
  });

  it('every tool has a unique key', () => {
    const keys = TOOL_REGISTRY.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every tool has required fields', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.key).toBeTruthy();
      expect(tool.displayName).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.category).toBeTruthy();
      expect(tool.website).toBeTruthy();
      expect(tool.runnerKey).toBeTruthy();
      expect(['free', 'free_tier', 'paid']).toContain(tool.pricing);
    }
  });
});
