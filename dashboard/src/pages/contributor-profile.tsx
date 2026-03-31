import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  useContributor,
  useContributorActivity,
  useContributorRepos,
  useContributorAssessments,
} from '@/api/hooks';
import { useWorkspace } from '@/lib/workspace';
import { ErrorBoundary } from '@/components/error-boundary';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { MarkdownContent } from '@/components/markdown-content';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { detectRole } from '@/lib/role-detection';
import { ProviderIcon } from '@/lib/provider-icons';
import type {
  Contributor,
  ContributorDailyActivity,
  ContributorRepoStats,
  ContributorAssessment,
} from '@/api/contributor-types';

export function ContributorProfilePage() {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const { id } = useParams();
  const devId = Number(id);
  const { data: dev, isLoading } = useContributor(devId);
  const { data: activity } = useContributorActivity(devId);
  const { data: repos } = useContributorRepos(devId);
  const { data: assessments } = useContributorAssessments(devId);
  const { languageStats, totalFileChanges, mergedFileTypes } = useMemo(() => {
    if (!repos || repos.length === 0) return { languageStats: [], totalFileChanges: 0, mergedFileTypes: {} };
    const merged: Record<string, number> = {};
    for (const repo of repos) {
      for (const [rawExt, count] of Object.entries(repo.fileTypes)) {
        // Normalize: "path/to/Dockerfile" → "Dockerfile", keep normal extensions as-is
        const ext = rawExt.includes('/') ? rawExt.split('/').pop()! : rawExt;
        merged[ext] = (merged[ext] || 0) + count;
      }
    }
    const sorted = Object.entries(merged)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
    return {
      languageStats: sorted,
      totalFileChanges: sorted.reduce((sum, [, n]) => sum + n, 0),
      mergedFileTypes: merged,
    };
  }, [repos]);

  const roleResult = useMemo(() => detectRole(mergedFileTypes), [mergedFileTypes]);

  if (isLoading) {
    return (
      <div className="beast-stack">
        <div className="beast-skeleton beast-skeleton-title" />
        <div className="beast-skeleton beast-skeleton-card" />
        <div className="beast-grid-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="beast-skeleton beast-skeleton-metric" />
          ))}
        </div>
        <div className="beast-skeleton beast-skeleton-block" />
        <div className="beast-skeleton beast-skeleton-block-lg" />
      </div>
    );
  }

  if (!dev) {
    return (
      <div className="beast-empty">
        <p className="beast-empty-title">Contributor not found</p>
        <Link to="/contributors" className="beast-btn beast-btn-ghost beast-mt-xs">
          Back to Contributors
        </Link>
      </div>
    );
  }

  const hasScores = dev.scoreOverall !== null;
  const hasActivity = activity && activity.length > 0;

  return (
    <ErrorBoundary>
      <div className="beast-stack">
        <BreadcrumbNav items={[{ label: 'Contributors', to: '/contributors' }, { label: dev?.displayName || dev?.emails?.[0] || '...' }]} />

        {/* Profile hero + stats 2x2 */}
        <div className="beast-grid-2">
          {/* Left: profile card */}
          <div className="beast-card beast-profile-hero">
            <div className="beast-profile-identity">
              <div className={cn(
                'beast-avatar beast-profile-avatar',
                hasScores && dev.scoreOverall! >= 7
                  ? 'beast-score-good-bg beast-score-good-text beast-score-good-border'
                  : hasScores && dev.scoreOverall! >= 5
                    ? 'beast-score-mid-bg beast-score-mid-text beast-score-mid-border'
                    : hasScores
                      ? 'beast-score-bad-bg beast-score-bad-text beast-score-bad-border'
                      : 'beast-avatar-neutral',
              )}>
                {dev.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="beast-profile-info">
                <h1 className="beast-profile-name">{dev.displayName}</h1>
                <p className="beast-profile-email">
                  {dev.emails.join(' \u00B7 ')}
                </p>
                {(dev.firstSeen || dev.lastSeen) && (
                  <p className="beast-profile-meta">
                    Active {dev.firstSeen ? `since ${formatDate(dev.firstSeen)}` : ''}
                    {dev.firstSeen && dev.lastSeen ? ' \u2014 ' : ''}
                    {dev.lastSeen ? `last seen ${formatDate(dev.lastSeen)}` : ''}
                  </p>
                )}
              </div>
            </div>
            <div className="beast-profile-divider" />
            <OverallScore score={dev.scoreOverall} />
          </div>

          {/* Right: 2x2 stats grid */}
          <div className="beast-grid-2-dense">
            <StatCard label="Commits" value={dev.totalCommits.toLocaleString()} icon={CommitIcon} />
            <StatCard label="Repositories" value={String(dev.repoCount)} icon={RepoIcon} />
            <StatCard
              label="Lines Added"
              value={`+${formatLOC(dev.totalLocAdded)}`}
              className="beast-score-good-text"
              icon={PlusIcon}
            />
            <StatCard
              label="Lines Removed"
              value={`-${formatLOC(dev.totalLocRemoved)}`}
              className="beast-score-bad-text"
              icon={MinusIcon}
            />
          </div>
        </div>

        {/* Contribution Heatmap + date stats */}
        <div className="beast-grid-2">
          <section>
            <SectionHeader title="Contribution Activity" subtitle="Last 52 weeks of commit history" />
            <div className="beast-card beast-overflow-auto">
              <ContributionHeatmap activity={activity || []} />
              {!hasActivity && (
                <p className="beast-page-subtitle beast-text-center beast-mt-sm">
                  No commit activity in the last 52 weeks. This contributor's commits may be older.
                </p>
              )}
            </div>
          </section>
          <div className="beast-stack-stretch beast-mt-section-header">
            <StatCard
              label="First Commit"
              value={dev.firstSeen ? formatDateShort(dev.firstSeen) : '\u2014'}
              icon={ClockIcon}
            />
            <StatCard
              label="Last Commit"
              value={dev.lastSeen ? formatDateShort(dev.lastSeen) : '\u2014'}
              icon={ClockIcon}
            />
          </div>
        </div>

        {/* Code Quality + Languages row */}
        <div className="beast-grid-60-40">
          <section>
            <SectionHeader
              title="Code Quality Assessment"
              subtitle={hasScores
                ? `Based on ${assessments?.length || 0} assessment${(assessments?.length || 0) !== 1 ? 's' : ''} across ${dev.repoCount} repo${dev.repoCount !== 1 ? 's' : ''}`
                : 'AI-powered analysis of code quality and security practices'
              }
            />
            <div className="beast-card">
              {hasScores ? (
                <ScoreBreakdown dev={dev} />
              ) : (
                <div className="beast-empty">
                  <div className="beast-empty-icon">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="beast-icon-muted">
                      <path d="M10 2l2.5 5 5.5.8-4 3.9.9 5.5L10 14.7l-4.9 2.5.9-5.5-4-3.9 5.5-.8L10 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="beast-empty-title">Not Yet Assessed</p>
                  <p className="beast-page-subtitle beast-empty-desc">
                    Assessments are generated during repository scans with AI analysis enabled.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section>
            <SectionHeader title="Languages & Technologies" subtitle="File types touched across all repositories" />
            <div className="beast-card beast-card-flush beast-overflow-hidden">
              {languageStats.length > 0 ? (
                <>
                  <div className="beast-lang-summary">
                    <span className="beast-lang-role">{roleResult.role}</span>
                    <span className="beast-flex-1" />
                    <span className="beast-metric-value beast-metric-value-sm">{totalFileChanges.toLocaleString()}</span>
                    <span className="beast-text-hint beast-mb-0">files</span>
                  </div>
                  <div className="beast-lang-list">
                    {languageStats.map(([ext, count], i) => {
                      const pct = totalFileChanges > 0 ? (count / totalFileChanges) * 100 : 0;
                      return (
                        <div key={ext} className={cn('beast-lang-row', i % 2 === 0 && 'beast-lang-row-alt')}>
                          <div className="beast-lang-rank">{i + 1}</div>
                          <code className="beast-lang-ext">{ext}</code>
                          <div className="beast-progress beast-progress-sm">
                            <div
                              className="beast-progress-fill beast-progress-red"
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                          <span className="beast-lang-count">{count.toLocaleString()}</span>
                          <span className="beast-lang-pct">{Math.round(pct)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="beast-empty">
                  <p className="beast-empty-title">No file type data available yet</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Overall Feedback */}
        {dev.feedback && (
          <section>
            <SectionHeader title="Contributor Profile Summary" subtitle="AI-compiled assessment across all repositories" />
            <div className="beast-card">
              <MarkdownContent content={dev.feedback} />
            </div>
          </section>
        )}

        {/* Repository Breakdown */}
        <RepoSection repos={repos || []} />

        {/* Assessment History */}
        <section>
          <SectionHeader
            title={`Assessment History (${assessments?.length || 0})`}
            subtitle="AI-generated code quality reviews from each repository scan"
          />
          {assessments && assessments.length > 0 ? (
            <div className="beast-stack-sm">
              {assessments.map((a) => (
                <AssessmentCard key={a.id} assessment={a} />
              ))}
            </div>
          ) : (
            <div className="beast-empty">
              <div className="beast-empty-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="beast-icon-muted">
                  <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </div>
              <p className="beast-empty-title">No Assessments Yet</p>
              <p className="beast-page-subtitle beast-empty-desc">
                Each repository scan generates a detailed code quality assessment for active contributors.
                Assessments evaluate security practices, code quality, design patterns, testing habits,
                and innovative approaches. Scores accumulate over time to build a comprehensive contributor profile.
              </p>
            </div>
          )}
        </section>
      </div>

    </ErrorBoundary>
  );
}

// Section Header

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="beast-mb-sm">
      <h2 className="beast-card-title beast-mb-0">{title}</h2>
      {subtitle && <p className="beast-page-subtitle beast-mt-xs">{subtitle}</p>}
    </div>
  );
}

// Stat Card — uses toolkit beast-metric pattern

function StatCard({
  label,
  value,
  className,
  icon: Icon,
}: {
  label: string;
  value: string;
  className?: string;
  icon: () => React.JSX.Element;
}) {
  return (
    <div className="beast-metric">
      <div className="beast-flex beast-flex-gap-sm beast-mb-xs">
        <Icon />
        <span className="beast-metric-label">{label}</span>
      </div>
      <p className={cn('beast-metric-value beast-metric-value-sm', className)}>{value}</p>
    </div>
  );
}

// Overall Score

function OverallScore({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="beast-profile-score">
        <span className="beast-profile-score-value beast-icon-muted">&mdash;</span>
        <span className="beast-profile-score-label beast-icon-muted">Not assessed</span>
      </div>
    );
  }
  const rounded = Math.round(score * 10) / 10;
  const colorClass = rounded >= 7
    ? 'beast-score-good-text'
    : rounded >= 5
      ? 'beast-score-mid-text'
      : 'beast-score-bad-text';
  return (
    <div className="beast-profile-score">
      <span className={cn('beast-profile-score-value', colorClass)}>
        {rounded.toFixed(1)}
      </span>
      <span className="beast-profile-score-sub">out of 10</span>
    </div>
  );
}

// Contribution Heatmap

function ContributionHeatmap({ activity }: { activity: ContributorDailyActivity[] }) {
  const { grid, months, maxCount, totalCommits } = useMemo(() => {
    const activityMap = new Map<string, number>();
    let max = 0;
    let total = 0;
    for (const d of activity) {
      const dateStr = d.activityDate.split('T')[0];
      activityMap.set(dateStr, d.commitCount);
      if (d.commitCount > max) max = d.commitCount;
      total += d.commitCount;
    }

    const today = new Date();
    const weeks: { date: Date; count: number }[][] = [];
    const monthLabels: { label: string; col: number }[] = [];

    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() - 52 * 7);

    let lastMonth = -1;
    for (let w = 0; w < 53; w++) {
      const week: { date: Date; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const key = date.toISOString().split('T')[0];
        const count = activityMap.get(key) || 0;
        week.push({ date, count });

        if (d === 0 && date.getMonth() !== lastMonth) {
          lastMonth = date.getMonth();
          monthLabels.push({
            label: date.toLocaleString('default', { month: 'short' }),
            col: w,
          });
        }
      }
      weeks.push(week);
    }

    return { grid: weeks, months: monthLabels, maxCount: max, totalCommits: total };
  }, [activity]);

  const cellSize = 11;
  const gap = 4;
  const labelWidth = 36;
  const topMargin = 16;
  const width = labelWidth + grid.length * (cellSize + gap);
  const height = topMargin + 7 * (cellSize + gap);

  function getColor(count: number): string {
    if (count === 0) return '#eeeeee';
    if (maxCount === 0) return '#eeeeee';
    // Log scale so light days don't cluster at the top
    const ratio = Math.log(count + 1) / Math.log(maxCount + 1);
    if (ratio <= 0.25) return '#9be9a8';
    if (ratio <= 0.5) return '#40c463';
    if (ratio <= 0.75) return '#30a14e';
    return '#216e39';
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      {/* Legend row */}
      <div className="beast-flex-between beast-mb-sm">
        <span className="beast-text-hint beast-mb-0">
          {totalCommits > 0
            ? `${totalCommits} contribution${totalCommits !== 1 ? 's' : ''} in the last year`
            : 'No contributions in the last year'}
        </span>
        <div className="beast-flex beast-flex-gap-xs">
          <span className="beast-text-hint beast-mb-0">Less</span>
          {['#eeeeee', '#9be9a8', '#40c463', '#30a14e', '#216e39'].map((c) => (
            <span key={c} className="beast-heatmap-swatch" style={{ backgroundColor: c }} />
          ))}
          <span className="beast-text-hint beast-mb-0">More</span>
        </div>
      </div>

      <svg width={width} height={height + 4} className="beast-select-none">
        {/* Month labels */}
        {months.map((m, i) => (
          <text
            key={i}
            x={labelWidth + m.col * (cellSize + gap)}
            y={10}
            className="beast-heatmap-label"
            fill="var(--th-text-muted)"
          >
            {m.label}
          </text>
        ))}

        {/* Day labels */}
        {dayLabels.map((label, i) => (
          <text
            key={i}
            x={0}
            y={topMargin + i * (cellSize + gap) + cellSize - 4}
            className="beast-heatmap-label"
            fill="var(--th-text-muted)"
          >
            {label}
          </text>
        ))}

        {/* Cells */}
        {grid.map((week, wi) =>
          week.map((day, di) => {
            const x = labelWidth + wi * (cellSize + gap);
            const y = topMargin + di * (cellSize + gap);
            const now = new Date();
            if (day.date > now) return null;
            return (
              <rect
                key={`${wi}-${di}`}
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                rx={0}
                fill={getColor(day.count)}
                className="beast-heatmap-cell"
              >
                <title>
                  {formatDate(day.date)}
                  : {day.count} commit{day.count !== 1 ? 's' : ''}
                </title>
              </rect>
            );
          }),
        )}
      </svg>
    </div>
  );
}

// Score Breakdown

const SCORE_CATEGORIES = [
  { key: 'security' as const, label: 'Security', desc: 'Secure coding, input validation, no hardcoded secrets', color: 'beast-progress-blue', badgeClass: 'beast-badge-blue' },
  { key: 'quality' as const, label: 'Code Quality', desc: 'Clean code, naming, abstractions, error handling', color: 'beast-progress-purple', badgeClass: 'beast-badge-purple' },
  { key: 'patterns' as const, label: 'Patterns', desc: 'Project conventions, idiomatic framework usage', color: 'beast-progress-cyan', badgeClass: 'beast-badge-cyan' },
  { key: 'testing' as const, label: 'Testing', desc: 'Test coverage, edge cases, integration tests', color: 'beast-progress-amber', badgeClass: 'beast-badge-amber' },
  { key: 'innovation' as const, label: 'Innovation', desc: 'Architecture decisions, modern approaches, performance', color: 'beast-progress-pink', badgeClass: 'beast-badge-pink' },
] as const;

function ScoreBreakdown({ dev }: { dev: Contributor }) {
  const scores: Record<string, number | null> = {
    security: dev.scoreSecurity,
    quality: dev.scoreQuality,
    patterns: dev.scorePatterns,
    testing: dev.scoreTesting,
    innovation: dev.scoreInnovation,
  };

  return (
    <div className="beast-stack">
      {SCORE_CATEGORIES.map(({ key, label, desc, color, badgeClass }) => {
        const score = scores[key];
        const pct = score !== null ? (score / 10) * 100 : 0;
        const scoreLabel = score !== null
          ? score >= 8 ? 'Excellent' : score >= 6 ? 'Good' : score >= 4 ? 'Fair' : 'Needs Work'
          : null;

        return (
          <div key={key}>
            <div className="beast-mb-xs">
              <span className="beast-td-primary">{label}</span>
              <span className="beast-text-detail beast-ml-xs">{desc}</span>
            </div>
            <div className="beast-flex-end beast-flex-gap-sm">
              <div className="beast-progress beast-progress-score">
                <div
                  className={cn('beast-progress-fill', color)}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={cn(
                  'beast-metric-value beast-metric-value-sm beast-w-32 beast-text-right beast-flex-shrink-0',
                  score === null
                    ? 'beast-icon-muted'
                    : score >= 7
                      ? 'beast-score-good-text'
                      : score >= 5
                        ? 'beast-score-mid-text'
                        : 'beast-score-bad-text',
                )}
              >
                {score !== null ? score.toFixed(1) : '\u2014'}
              </span>
              {scoreLabel && (
                <span className={cn('beast-badge beast-badge-sm', badgeClass)}>
                  {scoreLabel}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Summary line */}
      {dev.scoreOverall !== null && (
        <div className="beast-flex-between beast-pt-md beast-border-top">
          <span className="beast-td-primary beast-font-semibold">Overall Score</span>
          <span
            className={cn(
              'beast-metric-value',
              dev.scoreOverall >= 7
                ? 'beast-score-good-text'
                : dev.scoreOverall >= 5
                  ? 'beast-score-mid-text'
                  : 'beast-score-bad-text',
            )}
          >
            {dev.scoreOverall.toFixed(1)}/10
          </span>
        </div>
      )}
    </div>
  );
}

// Repo Section (grid + expand)

const REPOS_PER_PAGE = 6;

function RepoSection({ repos }: { repos: ContributorRepoStats[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(() => [...repos].sort((a, b) => b.commitCount - a.commitCount), [repos]);
  const visible = expanded ? sorted : sorted.slice(0, REPOS_PER_PAGE);
  const hasMore = sorted.length > REPOS_PER_PAGE;

  return (
    <section>
      <SectionHeader
        title={`Contributing to ${repos.length} Repositor${repos.length === 1 ? 'y' : 'ies'}`}
        subtitle="Commit share and file types per repository"
      />
      {repos.length > 0 ? (
        <>
          <div className="beast-repo-grid">
            {visible.map((repo) => (
              <RepoCard key={repo.id} repo={repo} />
            ))}
          </div>
          {hasMore && (
            <div className="beast-text-center beast-mt-sm">
              <button
                className="beast-btn beast-btn-ghost"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? 'Show Less' : `Show All ${repos.length} Repositories`}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="beast-empty">
          <p className="beast-empty-title">No repository data collected yet</p>
          <p className="beast-page-subtitle beast-mt-xs">
            Repository stats appear after scanning repos this contributor contributes to
          </p>
        </div>
      )}
    </section>
  );
}

// Repo Card

function RepoCard({ repo }: { repo: ContributorRepoStats }) {
  const topTypes = Object.entries(
    Object.entries(repo.fileTypes).reduce<Record<string, number>>((acc, [rawExt, count]) => {
      const ext = rawExt.includes('/') ? rawExt.split('/').pop()! : rawExt;
      acc[ext] = (acc[ext] || 0) + count;
      return acc;
    }, {}),
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4);

  const repoTotal = repo.repoTotalCommits || 0;
  const commitPct = repoTotal > 0 ? (repo.commitCount / repoTotal) * 100 : 0;
  const provider = detectProviderFromUrl(repo.repoUrl);

  return (
    <div className="beast-repo-card">
      <div className="beast-repo-card-header">
        <div className="beast-repo-card-identity">
          <div className={cn('beast-repo-card-icon', `beast-repo-card-icon--${provider}`)}>
            <ProviderIcon provider={provider} className="beast-repo-card-provider-icon" />
          </div>
          <div>
            {repo.repositoryId ? (
              <Link to={`/repos/${repo.repositoryId}`} className="beast-repo-card-name">
                {repo.repoName}
              </Link>
            ) : (
              <span className="beast-repo-card-name">{repo.repoName}</span>
            )}
            {(repo.firstCommit || repo.lastCommit) && (
              <div className="beast-repo-card-dates">
                {repo.firstCommit && formatDateShort(repo.firstCommit)}
                {repo.firstCommit && repo.lastCommit && ' \u2014 '}
                {repo.lastCommit && formatDateShort(repo.lastCommit)}
              </div>
            )}
          </div>
        </div>

        <div className="beast-repo-card-commits">
          <span className="beast-repo-card-commit-value">{repo.commitCount.toLocaleString()}</span>
          <span className="beast-repo-card-commit-label">
            of {repoTotal.toLocaleString()} commits
          </span>
        </div>
      </div>

      <div className="beast-repo-card-body">
        <div className="beast-repo-card-stats">
          <div className="beast-repo-card-stat">
            <span className="beast-repo-card-stat-value beast-loc-added">
              +{formatLOC(repo.locAdded)}
            </span>
            <span className="beast-repo-card-stat-label">added</span>
          </div>
          <div className="beast-repo-card-stat">
            <span className="beast-repo-card-stat-value beast-loc-removed">
              -{formatLOC(repo.locRemoved)}
            </span>
            <span className="beast-repo-card-stat-label">removed</span>
          </div>
        </div>

        {topTypes.length > 0 && (
          <div className="beast-repo-card-filetypes">
            {topTypes.map(([ext, count]) => (
              <span key={ext} className="beast-repo-card-filetype">
                <code>{ext}</code>
                <span>{count.toLocaleString()}</span>
              </span>
            ))}
          </div>
        )}

        <div className="beast-repo-card-bar">
          <div
            className="beast-repo-card-bar-fill"
            style={{ width: `${Math.max(commitPct, 1)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Assessment Card

function AssessmentCard({ assessment }: { assessment: ContributorAssessment }) {
  const scores = [
    { label: 'Security', value: assessment.scoreSecurity, color: 'beast-progress-blue' },
    { label: 'Quality', value: assessment.scoreQuality, color: 'beast-progress-purple' },
    { label: 'Patterns', value: assessment.scorePatterns, color: 'beast-progress-cyan' },
    { label: 'Testing', value: assessment.scoreTesting, color: 'beast-progress-amber' },
    { label: 'Innovation', value: assessment.scoreInnovation, color: 'beast-progress-pink' },
  ];

  const avg =
    scores.filter((s) => s.value !== null).length > 0
      ? scores.reduce((sum, s) => sum + (s.value ?? 0), 0) / scores.filter((s) => s.value !== null).length
      : null;

  return (
    <div className="beast-card beast-card-flush beast-overflow-hidden">
      <div className="beast-section-header beast-flex-between">
        <div className="beast-flex beast-flex-gap-sm">
          <span className="beast-text-hint beast-mb-0">
            {formatDate(assessment.assessedAt)}
          </span>
          {assessment.repoName && (
            <span className="beast-badge beast-badge-gray">
              {assessment.repoName}
            </span>
          )}
        </div>
        {avg !== null && (
          <span
            className={cn(
              'beast-score',
              avg >= 7
                ? 'beast-score-good'
                : avg >= 5
                  ? 'beast-score-mid'
                  : 'beast-score-bad',
            )}
          >
            {avg.toFixed(1)}
          </span>
        )}
      </div>

      <div className="beast-p-md">
        <div className="beast-flex beast-flex-gap beast-mb-sm">
          {scores.map(({ label, value, color }) => (
            <div key={label} className="beast-flex-1 beast-min-w-0">
              <div className="beast-flex-between beast-mb-xs">
                <span className="beast-text-hint beast-truncate beast-mb-0">{label}</span>
                <span
                  className={cn(
                    'beast-text-hint beast-mb-0 beast-font-semibold',
                    value === null
                      ? ''
                      : value >= 7
                        ? 'beast-score-good-text'
                        : value >= 5
                          ? 'beast-score-mid-text'
                          : 'beast-score-bad-text',
                  )}
                >
                  {value !== null ? value.toFixed(0) : '\u2014'}
                </span>
              </div>
              <div className="beast-progress beast-progress-xs">
                <div
                  className={cn('beast-progress-fill', color)}
                  style={{ width: `${value !== null ? (value / 10) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {assessment.feedback ? (
          <div className="beast-card-nested">
            <MarkdownContent content={assessment.feedback} />
          </div>
        ) : assessment.notes ? (
          <div className="beast-card-nested">
            <p className="beast-modal-body beast-mb-0 beast-whitespace-pre">{assessment.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Icons

function CommitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="beast-icon-muted">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v4M8 11v4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="beast-score-good-text">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="beast-score-bad-text">
      <path d="M3 8h10" />
    </svg>
  );
}

function RepoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="beast-icon-muted">
      <path d="M2 4.5h4l1.5 2H14v7H2V4.5z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="beast-icon-muted">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

// Helpers

function detectProviderFromUrl(url: string | null): string {
  if (!url) return 'local';
  if (url.includes('github.com') || url.includes('github')) return 'github';
  if (url.includes('bitbucket.org') || url.includes('bitbucket')) return 'bitbucket';
  if (url.includes('gitlab.com') || url.includes('gitlab')) return 'gitlab';
  return 'local';
}

function formatLOC(n: number | string): string {
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function formatDateShort(d: string): string {
  const dt = new Date(d);
  const m = dt.getMonth() + 1;
  return `${m < 10 ? '0' : ''}${m}.${dt.getFullYear()}`;
}
