// Deterministic "Verified statistics" block for the AI-generated Security
// Audit report (scan_file 'final-report.md', fileType 'audit').
//
// QA found the LLM's own aggregate arithmetic wrong in 2 of 5 reports
// ("18 High" vs an actual 16; totals off by one) — numbers shown to customers
// must come from the scan DATABASE, not from the model's head. The commit
// step computes these stats from the plan it just committed and prepends this
// block to the stored report; the triage prompt forbids the agent from
// writing its own totals.
//
// Pure functions — no db access — so the table math is unit-testable.

/** Severity display order — mirrors VALID_SEVERITIES in entities.ts.
 *  Prepared findings arrive normalized; anything else buckets to Info
 *  (same fallback as normalizeSeverity). */
const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;

/** Marker comments make the insert idempotent: a commit re-run (resume after
 *  a mid-commit crash) REPLACES the previous block instead of stacking a
 *  second copy on the same report. */
// [//]: # markdown-comment form — HTML comments render as visible text in the
// dashboard's markdown viewer; this form renders as nothing.
export const STATS_BLOCK_START = '[//]: # (beast:verified-stats)';
export const STATS_BLOCK_END = '[//]: # (/beast:verified-stats)';

export interface CommittedFindingStat {
  severity: string;
  /** True when the committed row's FINAL status is 'open'. False covers both
   *  fresh triage dismissals and preserved manual dispositions — the report
   *  reflects what is actually in the DB. */
  open: boolean;
}

export interface VerifiedStats {
  findings: CommittedFindingStat[];
  testsCreated: number;
  findingsNew: number;
  findingsUpdated: number;
  /** Findings dismissed by THIS scan's auto-triage (decisions applied). */
  dismissed: number;
  /** AI findings semantically deduplicated onto existing rows (same_as). */
  semanticMatches: number;
}

// Two hardcoded variants (KISS): workspaces report in English by default;
// reportLanguage 'uk' gets Ukrainian headers. Severity values and tool terms
// stay in English in every language (same rule as the report prompt).
const LABELS = {
  en: {
    heading: 'Verified Statistics',
    note: 'Generated from the scan database, not by the AI.',
    severity: 'Severity',
    open: 'Open',
    dismissedCol: 'Dismissed by triage',
    total: 'Total',
    tests: 'Security tests',
    findings: (n: number, u: number) => `Findings: ${n} new, ${u} updated`,
    autoDismissed: 'Auto-dismissed by triage',
    semantic: 'Semantically deduplicated',
  },
  uk: {
    heading: 'Перевірена статистика',
    note: 'Згенеровано з бази даних сканування, а не штучним інтелектом.',
    severity: 'Серйозність',
    open: 'Відкриті',
    dismissedCol: 'Відхилені тріажем',
    total: 'Разом',
    tests: 'Тести безпеки',
    findings: (n: number, u: number) => `Знахідки: ${n} нових, ${u} оновлених`,
    autoDismissed: 'Автоматично відхилено тріажем',
    semantic: 'Семантично дедупліковано',
  },
} as const;

/**
 * Build the marker-wrapped markdown block. All numbers come from the commit
 * step's committed plan — per-severity rows from the actual final status of
 * every committed finding, bullets from the commit counters.
 */
export function buildVerifiedStatsBlock(stats: VerifiedStats, reportLanguage: string): string {
  const l = reportLanguage === 'uk' ? LABELS.uk : LABELS.en;

  const openBySeverity = new Map<string, number>();
  const dismissedBySeverity = new Map<string, number>();
  let totalOpen = 0;
  let totalDismissed = 0;

  for (const f of stats.findings) {
    const severity = (SEVERITY_ORDER as readonly string[]).includes(f.severity) ? f.severity : 'Info';
    const bucket = f.open ? openBySeverity : dismissedBySeverity;
    bucket.set(severity, (bucket.get(severity) ?? 0) + 1);
    if (f.open) totalOpen++; else totalDismissed++;
  }

  const lines = [
    STATS_BLOCK_START,
    `## ${l.heading}`,
    '',
    `_${l.note}_`,
    '',
    `| ${l.severity} | ${l.open} | ${l.dismissedCol} |`,
    '| --- | ---: | ---: |',
    ...SEVERITY_ORDER.map(severity =>
      `| ${severity} | ${openBySeverity.get(severity) ?? 0} | ${dismissedBySeverity.get(severity) ?? 0} |`),
    `| **${l.total}** | **${totalOpen}** | **${totalDismissed}** |`,
    '',
    `- ${l.tests}: ${stats.testsCreated}`,
    `- ${l.findings(stats.findingsNew, stats.findingsUpdated)}`,
    `- ${l.autoDismissed}: ${stats.dismissed}`,
    `- ${l.semantic}: ${stats.semanticMatches}`,
    '',  // blank line — the [//]: # marker is invisible only as its own paragraph
    STATS_BLOCK_END,
  ];

  return lines.join('\n');
}

/**
 * Insert the block right after the report's first H1 line (or at the very top
 * when there is no H1). Any previously inserted marker-delimited block is
 * stripped first, so re-running the commit step never stacks duplicates.
 */
export function insertVerifiedStats(report: string, block: string): string {
  const stripped = report
    .replace(/\[\/\/\]: # \(beast:verified-stats\)[\s\S]*?\[\/\/\]: # \(\/beast:verified-stats\)\n*/g, '')
    .replace(/\n{3,}/g, '\n\n');

  const h1 = stripped.match(/^# .*$/m);
  if (h1 && h1.index != null) {
    const end = h1.index + h1[0].length;
    const rest = stripped.slice(end).replace(/^\n+/, '');
    return `${stripped.slice(0, end)}\n\n${block}\n${rest ? `\n${rest}` : ''}`;
  }
  return `${block}\n\n${stripped.replace(/^\n+/, '')}`;
}
