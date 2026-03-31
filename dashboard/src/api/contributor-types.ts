export interface Contributor {
  id: number;
  teamId: number | null;
  displayName: string;
  emails: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  totalCommits: number;
  totalLocAdded: number;
  totalLocRemoved: number;
  repoCount: number;
  scoreOverall: number | null;
  scoreSecurity: number | null;
  scoreQuality: number | null;
  scorePatterns: number | null;
  scoreTesting: number | null;
  scoreInnovation: number | null;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContributorRepoStats {
  id: number;
  contributorId: number;
  repoName: string;
  repoUrl: string | null;
  repositoryId: number | null;
  commitCount: number;
  locAdded: number;
  locRemoved: number;
  firstCommit: string | null;
  lastCommit: string | null;
  fileTypes: Record<string, number>;
  repoTotalCommits: number;
  updatedAt: string;
}

export interface ContributorDailyActivity {
  activityDate: string;
  commitCount: number;
}

export interface ContributorAssessment {
  id: number;
  contributorId: number;
  repoName: string | null;
  executionId: string | null;
  assessedAt: string;
  scoreSecurity: number | null;
  scoreQuality: number | null;
  scorePatterns: number | null;
  scoreTesting: number | null;
  scoreInnovation: number | null;
  notes: string | null;
  feedback: string | null;
  details: Record<string, unknown>;
}
