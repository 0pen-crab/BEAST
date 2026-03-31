import { describe, it, expect } from 'vitest';
import { SEVERITIES, STATUSES, REPO_STATUSES } from './types';

describe('SEVERITIES', () => {
  it('contains all severity levels', () => {
    expect(SEVERITIES).toEqual(['Critical', 'High', 'Medium', 'Low', 'Info']);
  });

  it('has 5 levels', () => {
    expect(SEVERITIES).toHaveLength(5);
  });

  it('is in priority order (Critical first)', () => {
    expect(SEVERITIES[0]).toBe('Critical');
    expect(SEVERITIES[SEVERITIES.length - 1]).toBe('Info');
  });

  it('is readonly', () => {
    // TypeScript enforces this at compile time with 'as const',
    // but we can verify the values are stable
    const copy = [...SEVERITIES];
    expect(copy).toEqual(['Critical', 'High', 'Medium', 'Low', 'Info']);
  });
});

describe('STATUSES', () => {
  it('contains all status options', () => {
    expect(STATUSES).toEqual(['Open', 'Risk Accepted', 'False Positive', 'Fixed', 'Duplicate']);
  });

  it('has 5 statuses', () => {
    expect(STATUSES).toHaveLength(5);
  });

  it('includes Open as first status', () => {
    expect(STATUSES[0]).toBe('Open');
  });
});

describe('REPO_STATUSES', () => {
  it('contains all repository status values', () => {
    expect(REPO_STATUSES).toEqual(['pending', 'queued', 'analyzing', 'completed', 'ignored']);
  });

  it('has 5 statuses', () => {
    expect(REPO_STATUSES).toHaveLength(5);
  });

  it('includes pending and completed', () => {
    expect(REPO_STATUSES).toContain('pending');
    expect(REPO_STATUSES).toContain('completed');
  });
});
