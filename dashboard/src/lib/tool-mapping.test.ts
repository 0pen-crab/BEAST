import { describe, it, expect } from 'vitest';
import { TOOLS, TOOL_CATEGORIES, resolveToolFromTest, getToolByKey, getToolsByCategory } from './tool-mapping';
import type { ToolCategory } from '@/api/types';

describe('TOOLS', () => {
  it('contains expected tools', () => {
    expect(TOOLS.length).toBeGreaterThan(0);
  });

  it('each tool has required fields including category', () => {
    const validCategories: ToolCategory[] = ['secrets', 'sast', 'sca', 'iac'];
    for (const tool of TOOLS) {
      expect(tool.key).toBeTruthy();
      expect(tool.displayName).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.color).toBeTruthy();
      expect(tool.bgClass).toBeTruthy();
      expect(tool.textClass).toBeTruthy();
      expect(tool.borderClass).toBeTruthy();
      expect(tool.iconBg).toBeTruthy();
      expect(tool.lightBg).toBeTruthy();
      expect(validCategories).toContain(tool.category);
    }
  });

  it('contains beast, gitleaks, trufflehog, jfrog', () => {
    const keys = TOOLS.map((t) => t.key);
    expect(keys).toContain('beast');
    expect(keys).toContain('gitleaks');
    expect(keys).toContain('trufflehog');
    expect(keys).toContain('jfrog');
  });

  it('contains new tools: semgrep, osv-scanner, checkov, gitguardian', () => {
    const keys = TOOLS.map((t) => t.key);
    expect(keys).toContain('semgrep');
    expect(keys).toContain('osv-scanner');
    expect(keys).toContain('checkov');
    expect(keys).toContain('gitguardian');
  });

  it('contains snyk sub-keys: snyk-sca, snyk-code, snyk-iac', () => {
    const keys = TOOLS.map((t) => t.key);
    expect(keys).toContain('snyk-sca');
    expect(keys).toContain('snyk-code');
    expect(keys).toContain('snyk-iac');
  });

  it('contains trivy sub-keys: trivy-secrets, trivy-sca, trivy-iac', () => {
    const keys = TOOLS.map((t) => t.key);
    expect(keys).toContain('trivy-secrets');
    expect(keys).toContain('trivy-sca');
    expect(keys).toContain('trivy-iac');
  });

  it('trivy sub-keys have correct display names', () => {
    expect(getToolByKey('trivy-secrets')?.displayName).toBe('Trivy');
    expect(getToolByKey('trivy-sca')?.displayName).toBe('Trivy SCA');
    expect(getToolByKey('trivy-iac')?.displayName).toBe('Trivy IaC');
  });

  it('snyk sub-keys have correct display names', () => {
    expect(getToolByKey('snyk-sca')?.displayName).toBe('Snyk');
    expect(getToolByKey('snyk-code')?.displayName).toBe('Snyk Code');
    expect(getToolByKey('snyk-iac')?.displayName).toBe('Snyk IaC');
  });
});

describe('resolveToolFromTest', () => {
  it('resolves direct tool key', () => {
    expect(resolveToolFromTest('beast')?.key).toBe('beast');
    expect(resolveToolFromTest('gitleaks')?.key).toBe('gitleaks');
    expect(resolveToolFromTest('trufflehog')?.key).toBe('trufflehog');
    expect(resolveToolFromTest('jfrog')?.key).toBe('jfrog');
  });

  it('resolves new tool keys', () => {
    expect(resolveToolFromTest('semgrep')?.key).toBe('semgrep');
    expect(resolveToolFromTest('osv-scanner')?.key).toBe('osv-scanner');
    expect(resolveToolFromTest('checkov')?.key).toBe('checkov');
    expect(resolveToolFromTest('gitguardian')?.key).toBe('gitguardian');
    expect(resolveToolFromTest('snyk-sca')?.key).toBe('snyk-sca');
    expect(resolveToolFromTest('snyk-code')?.key).toBe('snyk-code');
    expect(resolveToolFromTest('snyk-iac')?.key).toBe('snyk-iac');
    expect(resolveToolFromTest('trivy-secrets')?.key).toBe('trivy-secrets');
    expect(resolveToolFromTest('trivy-sca')?.key).toBe('trivy-sca');
    expect(resolveToolFromTest('trivy-iac')?.key).toBe('trivy-iac');
  });

  it('returns undefined for unknown tool', () => {
    expect(resolveToolFromTest('unknown')).toBeUndefined();
  });

  it('returns undefined for unknown key', () => {
    expect(resolveToolFromTest('SARIF')).toBeUndefined();
  });
});

describe('getToolByKey', () => {
  it('returns tool by key', () => {
    const beast = getToolByKey('beast');
    expect(beast).toBeDefined();
    expect(beast?.displayName).toBe('BEAST');
  });

  it('returns undefined for unknown key', () => {
    expect(getToolByKey('nope')).toBeUndefined();
  });

  it('returns correct tool for each known key', () => {
    expect(getToolByKey('gitleaks')?.displayName).toBe('Gitleaks');
    expect(getToolByKey('jfrog')?.displayName).toBe('JFrog Xray');
  });
});

describe('TOOL_CATEGORIES', () => {
  it('has exactly 4 categories', () => {
    expect(TOOL_CATEGORIES).toHaveLength(4);
  });

  it('contains Code Analysis, Dependencies, Infrastructure, Secrets', () => {
    const keys = TOOL_CATEGORIES.map((c) => c.key);
    expect(keys).toContain('sast');
    expect(keys).toContain('sca');
    expect(keys).toContain('iac');
    expect(keys).toContain('secrets');
  });

  it('each category has display name, description, color, and icon', () => {
    for (const cat of TOOL_CATEGORIES) {
      expect(cat.key).toBeTruthy();
      expect(cat.displayName).toBeTruthy();
      expect(cat.description).toBeTruthy();
      expect(cat.color).toBeTruthy();
      expect(cat.bgClass).toBeTruthy();
      expect(cat.textClass).toBeTruthy();
      expect(cat.icon).toBeTruthy();
    }
  });
});

describe('getToolsByCategory', () => {
  it('returns tools for each category', () => {
    const secrets = getToolsByCategory('secrets');
    const sast = getToolsByCategory('sast');
    const sca = getToolsByCategory('sca');
    const iac = getToolsByCategory('iac');

    expect(secrets.length).toBeGreaterThan(0);
    expect(sast.length).toBeGreaterThan(0);
    expect(sca.length).toBeGreaterThan(0);
    expect(iac.length).toBeGreaterThan(0);
  });

  it('secrets category contains gitleaks, trufflehog, gitguardian, trivy-secrets', () => {
    const keys = getToolsByCategory('secrets').map((t) => t.key);
    expect(keys).toContain('gitleaks');
    expect(keys).toContain('trufflehog');
    expect(keys).toContain('gitguardian');
    expect(keys).toContain('trivy-secrets');
  });

  it('sast category contains beast, semgrep, snyk-code', () => {
    const keys = getToolsByCategory('sast').map((t) => t.key);
    expect(keys).toContain('beast');
    expect(keys).toContain('semgrep');
    expect(keys).toContain('snyk-code');
  });

  it('sca category contains snyk-sca, osv-scanner, jfrog, trivy-sca in order', () => {
    const keys = getToolsByCategory('sca').map((t) => t.key);
    expect(keys).toEqual(['snyk-sca', 'osv-scanner', 'jfrog', 'trivy-sca']);
  });

  it('iac category contains checkov, snyk-iac, trivy-iac', () => {
    const keys = getToolsByCategory('iac').map((t) => t.key);
    expect(keys).toContain('checkov');
    expect(keys).toContain('snyk-iac');
    expect(keys).toContain('trivy-iac');
  });

  it('all tools belong to exactly one category', () => {
    const allCategorized = ['secrets', 'sast', 'sca', 'iac'].flatMap(
      (cat) => getToolsByCategory(cat as ToolCategory).map((t) => t.key),
    );
    const toolKeys = TOOLS.map((t) => t.key);
    expect(allCategorized.sort()).toEqual(toolKeys.sort());
  });
});
