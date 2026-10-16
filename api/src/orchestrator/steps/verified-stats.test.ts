import { describe, it, expect } from 'vitest';
import {
  buildVerifiedStatsBlock,
  insertVerifiedStats,
  STATS_BLOCK_START,
  STATS_BLOCK_END,
  type VerifiedStats,
} from './verified-stats.ts';

const makeStats = (overrides: Partial<VerifiedStats> = {}): VerifiedStats => ({
  findings: [],
  testsCreated: 0,
  findingsNew: 0,
  findingsUpdated: 0,
  dismissed: 0,
  semanticMatches: 0,
  ...overrides,
});

// ── buildVerifiedStatsBlock — table math ───────────────────────────

describe('buildVerifiedStatsBlock', () => {
  it('splits per-severity counts into open vs dismissed columns with a totals row', () => {
    const block = buildVerifiedStatsBlock(makeStats({
      findings: [
        { severity: 'Critical', open: true },
        { severity: 'High', open: true },
        { severity: 'High', open: false },
        { severity: 'High', open: false },
        { severity: 'Medium', open: false },
        { severity: 'Low', open: true },
      ],
      testsCreated: 3,
      findingsNew: 5,
      findingsUpdated: 1,
      dismissed: 3,
      semanticMatches: 0,
    }), 'en');

    expect(block).toContain('| Critical | 1 | 0 |');
    expect(block).toContain('| High | 1 | 2 |');
    expect(block).toContain('| Medium | 0 | 1 |');
    expect(block).toContain('| Low | 1 | 0 |');
    expect(block).toContain('| Info | 0 | 0 |');
    expect(block).toContain('| **Total** | **3** | **3** |');
  });

  it('keeps a fixed Critical→Info severity row order', () => {
    const block = buildVerifiedStatsBlock(makeStats({
      findings: [
        { severity: 'Info', open: true },
        { severity: 'Critical', open: true },
      ],
    }), 'en');

    const rows = block.split('\n').filter(l => /^\| [A-Z]/.test(l) && !l.startsWith('| Severity'));
    expect(rows).toEqual([
      '| Critical | 1 | 0 |',
      '| High | 0 | 0 |',
      '| Medium | 0 | 0 |',
      '| Low | 0 | 0 |',
      '| Info | 1 | 0 |',
    ]);
  });

  it('buckets unknown severities under Info (mirrors normalizeSeverity)', () => {
    const block = buildVerifiedStatsBlock(makeStats({
      findings: [
        { severity: 'weird', open: true },
        { severity: 'Info', open: false },
      ],
    }), 'en');

    expect(block).toContain('| Info | 1 | 1 |');
    expect(block).toContain('| **Total** | **1** | **1** |');
  });

  it('includes the totals bullets from the commit counters, not from the table', () => {
    const block = buildVerifiedStatsBlock(makeStats({
      findings: [{ severity: 'High', open: true }],
      testsCreated: 4,
      findingsNew: 12,
      findingsUpdated: 3,
      dismissed: 7,
      semanticMatches: 2,
    }), 'en');

    expect(block).toContain('- Security tests: 4');
    expect(block).toContain('- Findings: 12 new, 3 updated');
    expect(block).toContain('- Auto-dismissed by triage: 7');
    expect(block).toContain('- Semantically deduplicated: 2');
  });

  it('wraps the block in idempotency markers and labels it as database-derived', () => {
    const block = buildVerifiedStatsBlock(makeStats(), 'en');

    expect(block.startsWith(STATS_BLOCK_START)).toBe(true);
    expect(block.endsWith(STATS_BLOCK_END)).toBe(true);
    expect(block).toContain('## Verified Statistics');
    expect(block).toContain('_Generated from the scan database, not by the AI._');
    expect(block).toContain('| Severity | Open | Dismissed by triage |');
  });

  it('emits the Ukrainian variant for reportLanguage uk (severity names stay English)', () => {
    const block = buildVerifiedStatsBlock(makeStats({
      findings: [{ severity: 'High', open: true }],
      testsCreated: 1,
      findingsNew: 1,
      findingsUpdated: 0,
      dismissed: 0,
      semanticMatches: 0,
    }), 'uk');

    expect(block).toContain('## Перевірена статистика');
    expect(block).toContain('_Згенеровано з бази даних сканування, а не штучним інтелектом._');
    expect(block).toContain('| Серйозність | Відкриті | Відхилені тріажем |');
    expect(block).toContain('| **Разом** | **1** | **0** |');
    expect(block).toContain('- Тести безпеки: 1');
    expect(block).toContain('- Знахідки: 1 нових, 0 оновлених');
    expect(block).toContain('- Автоматично відхилено тріажем: 0');
    expect(block).toContain('- Семантично дедупліковано: 0');
    // Severity values are technical terms — English in every language
    expect(block).toContain('| High | 1 | 0 |');
  });

  it('falls back to English for any non-uk language', () => {
    const block = buildVerifiedStatsBlock(makeStats(), 'de');
    expect(block).toContain('## Verified Statistics');
  });
});

// ── insertVerifiedStats — placement + idempotency ──────────────────

describe('insertVerifiedStats', () => {
  const block = buildVerifiedStatsBlock(makeStats({
    findings: [{ severity: 'High', open: true }],
    testsCreated: 1, findingsNew: 1,
  }), 'en');

  it('prepends the block right after the first H1 line', () => {
    const report = '# Security Audit\n\n## Executive Summary\n\nProse here.\n';
    const result = insertVerifiedStats(report, block);

    expect(result.startsWith(`# Security Audit\n\n${STATS_BLOCK_START}`)).toBe(true);
    // The rest of the report is preserved after the block
    const afterBlock = result.slice(result.indexOf(STATS_BLOCK_END) + STATS_BLOCK_END.length);
    expect(afterBlock).toContain('## Executive Summary');
    expect(afterBlock).toContain('Prose here.');
  });

  it('handles an H1 that is not the first line', () => {
    const report = 'Preamble line.\n\n# Security Audit\n\nBody.\n';
    const result = insertVerifiedStats(report, block);

    const h1Pos = result.indexOf('# Security Audit');
    const blockPos = result.indexOf(STATS_BLOCK_START);
    expect(blockPos).toBeGreaterThan(h1Pos);
    expect(result).toContain('Preamble line.');
    expect(result).toContain('Body.');
  });

  it('puts the block at the top when the report has no H1', () => {
    const report = '## Executive Summary\n\nNo H1 here.\n';
    const result = insertVerifiedStats(report, block);

    expect(result.startsWith(STATS_BLOCK_START)).toBe(true);
    expect(result).toContain('## Executive Summary');
  });

  it('is idempotent: re-inserting replaces the previous block instead of stacking', () => {
    const report = '# Security Audit\n\n## Executive Summary\n\nProse.\n';
    const once = insertVerifiedStats(report, block);

    const newerBlock = buildVerifiedStatsBlock(makeStats({
      findings: [{ severity: 'Critical', open: true }],
      testsCreated: 9, findingsNew: 9,
    }), 'en');
    const twice = insertVerifiedStats(once, newerBlock);

    expect(twice.match(/beast:verified-stats/g)).toHaveLength(2); // one start + one end marker
    expect(twice).toContain('- Security tests: 9');
    expect(twice).not.toContain('- Security tests: 1');
    expect(twice).toContain('## Executive Summary');
  });
});
