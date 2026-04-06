import { createHash, randomBytes } from 'crypto';
import { eq, ne, and, asc, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  workspaces, teams, repositories, tests, findings, findingNotes,
  scanFiles, scanNotes, users, sessions, sources,
  workspaceEvents, pullRequests, workspaceMembers, workspaceTools,
  type Workspace, type Team, type Repository, type Test, type Finding,
  type FindingNote, type ScanFile, type ScanNote, type User, type Session,
  type Source, type WorkspaceEvent, type PullRequest,
  type WorkspaceMember,
} from '../db/schema.ts';
import { getRecommendedToolKeys, getAllToolKeys } from '../lib/tool-registry.ts';
import { getSecret, deleteOwnerSecrets } from '../lib/vault.ts';

// ── Workspaces ────────────────────────────────────────────────

export async function createWorkspace(name: string, description?: string): Promise<Workspace> {
  const [row] = await db.insert(workspaces).values({
    name,
    description: description ?? null,
  }).returning();
  return row;
}

export async function getWorkspace(id: number): Promise<Workspace | null> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return rows[0] ?? null;
}

export async function findWorkspaceByName(name: string): Promise<Workspace | null> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.name, name));
  return rows[0] ?? null;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return db.select().from(workspaces).orderBy(workspaces.createdAt);
}

export async function ensureWorkspace(name: string): Promise<Workspace> {
  const existing = await findWorkspaceByName(name);
  if (existing) return existing;
  return createWorkspace(name);
}

// ── Teams ──────────────────────────────────────────────────────

export async function createTeam(workspaceId: number, name: string, description?: string): Promise<Team> {
  const [row] = await db.insert(teams).values({
    workspaceId,
    name,
    description: description ?? null,
  }).returning();
  return row;
}

export async function getTeam(id: number): Promise<Team | null> {
  const rows = await db.select().from(teams).where(eq(teams.id, id));
  return rows[0] ?? null;
}

export async function listTeamsByWorkspace(workspaceId: number): Promise<Team[]> {
  return db.select().from(teams)
    .where(eq(teams.workspaceId, workspaceId))
    .orderBy(teams.createdAt);
}

export async function ensureTeam(workspaceId: number, name: string): Promise<Team> {
  const rows = await db.select().from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), eq(teams.name, name)));
  if (rows[0]) return rows[0];
  return createTeam(workspaceId, name);
}

// ── Repositories ───────────────────────────────────────────────

export async function createRepository(teamId: number, name: string, repoUrl?: string): Promise<Repository> {
  const [row] = await db.insert(repositories).values({
    teamId,
    name,
    repoUrl: repoUrl ?? null,
  }).returning();
  return row;
}

export async function getRepository(id: number): Promise<Repository | null> {
  const rows = await db.select().from(repositories).where(eq(repositories.id, id));
  return rows[0] ?? null;
}

export async function findRepositoryByName(teamId: number, name: string): Promise<Repository | null> {
  const rows = await db.select().from(repositories)
    .where(and(eq(repositories.teamId, teamId), eq(repositories.name, name)));
  return rows[0] ?? null;
}

export async function listRepositoriesByTeam(teamId: number): Promise<Repository[]> {
  return db.select().from(repositories)
    .where(eq(repositories.teamId, teamId))
    .orderBy(repositories.createdAt);
}

/**
 * Look up a repository's source credentials by repo name (and optionally URL).
 * Returns the provider, token, and email needed for authenticated cloning, or null if
 * the repo has no linked source or credentials.
 */
export async function getRepoCloneCredentials(
  repoName: string,
  repoUrl?: string,
): Promise<{ provider: string; token: string; email?: string } | null> {
  const conditions: SQL[] = [eq(repositories.name, repoName)];
  if (repoUrl) conditions.push(eq(repositories.repoUrl, repoUrl));

  const rows = await db.select({
    sourceId: repositories.sourceId,
  }).from(repositories).where(and(...conditions)).limit(1);

  const srcId = rows[0]?.sourceId;
  if (!srcId) return null;

  const source = await db.select({
    provider: sources.provider,
    credentialUsername: sources.credentialUsername,
  }).from(sources).where(eq(sources.id, srcId)).limit(1);

  if (!source[0]) return null;

  const token = await getSecret('source', srcId, 'access_token');
  if (!token) return null;

  return {
    provider: source[0].provider,
    token,
    email: source[0].credentialUsername ?? undefined,
  };
}

export async function ensureRepository(teamId: number, name: string, repoUrl?: string): Promise<Repository> {
  const existing = await findRepositoryByName(teamId, name);
  if (existing) return existing;
  return createRepository(teamId, name, repoUrl);
}

// ── Fingerprint helper ─────────────────────────────────────────

export function computeFingerprint(
  tool: string | null | undefined,
  filePath: string | null | undefined,
  line: number | null | undefined,
  vulnId: string | null | undefined,
  title: string | null | undefined,
): string {
  const parts = [
    tool ?? '',
    filePath ?? '',
    line != null ? String(line) : '',
    vulnId ?? '',
    title ?? '',
  ];
  const input = parts.join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 40);
}

// ── Tests ──────────────────────────────────────────────────────

export async function createTest(data: {
  scanId: string;
  tool: string;
  scanType: string;
  testTitle?: string;
  fileName?: string;
}): Promise<Test> {
  const [row] = await db.insert(tests).values({
    scanId: data.scanId,
    tool: data.tool,
    scanType: data.scanType,
    testTitle: data.testTitle ?? null,
    fileName: data.fileName ?? null,
  }).returning();
  return row;
}

export async function getTestsByScan(scanId: string): Promise<Test[]> {
  return db.select().from(tests)
    .where(eq(tests.scanId, scanId))
    .orderBy(tests.createdAt);
}

export async function updateTestFindingsCount(testId: number, count: number): Promise<void> {
  await db.update(tests)
    .set({ findingsCount: count, importStatus: 'completed' })
    .where(eq(tests.id, testId));
}

// ── Findings ───────────────────────────────────────────────────

interface CreateFindingData {
  testId: number;
  repositoryId?: number;
  title: string;
  severity: string;
  description?: string;
  filePath?: string;
  line?: number;
  vulnIdFromTool?: string;
  cwe?: number;
  cvssScore?: number;
  tool: string;
  category?: string;
  codeSnippet?: string;
  secretValue?: string;
}

const VALID_SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;

function normalizeSeverity(raw: string): string {
  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  if ((VALID_SEVERITIES as readonly string[]).includes(capitalized)) return capitalized;
  return 'Info';
}

export async function createFinding(data: CreateFindingData): Promise<Finding> {
  const fingerprint = computeFingerprint(
    data.tool,
    data.filePath,
    data.line,
    data.vulnIdFromTool,
    data.title,
  );
  const severity = normalizeSeverity(data.severity);
  const [row] = await db.insert(findings).values({
    testId: data.testId,
    repositoryId: data.repositoryId ?? null,
    title: data.title,
    severity,
    description: data.description ?? null,
    filePath: data.filePath ?? null,
    line: data.line ?? null,
    vulnIdFromTool: data.vulnIdFromTool ?? null,
    cwe: data.cwe ?? null,
    cvssScore: data.cvssScore ?? null,
    tool: data.tool,
    category: data.category ?? null,
    codeSnippet: data.codeSnippet ?? null,
    secretValue: data.secretValue ?? null,
    fingerprint,
  }).returning();
  return row;
}

export async function upsertFinding(data: CreateFindingData): Promise<Finding> {
  const fingerprint = computeFingerprint(
    data.tool,
    data.filePath,
    data.line,
    data.vulnIdFromTool,
    data.title,
  );

  if (data.repositoryId) {
    const existing = await db.select().from(findings)
      .where(and(
        eq(findings.fingerprint, fingerprint),
        eq(findings.repositoryId, data.repositoryId),
        ne(findings.status, 'duplicate'),
      ));

    if (existing[0]) {
      const [updated] = await db.update(findings)
        .set({
          testId: data.testId,
          severity: normalizeSeverity(data.severity),
          description: data.description ?? null,
          category: data.category ?? existing[0].category,
          codeSnippet: data.codeSnippet ?? null,
          secretValue: data.secretValue ?? existing[0].secretValue,
          status: 'open',
          updatedAt: new Date(),
        })
        .where(eq(findings.id, existing[0].id))
        .returning();
      return updated;
    }
  }

  return createFinding(data);
}

export async function getFinding(id: number): Promise<Finding | null> {
  const rows = await db.select().from(findings).where(eq(findings.id, id));
  return rows[0] ?? null;
}

export async function listFindingsByRepository(
  repositoryId: number,
  opts?: { status?: string; severity?: string; tool?: string; limit?: number; offset?: number },
): Promise<{ count: number; results: Finding[] }> {
  const conditions: SQL[] = [eq(findings.repositoryId, repositoryId)];

  if (opts?.status) conditions.push(eq(findings.status, opts.status));
  if (opts?.severity) conditions.push(eq(findings.severity, opts.severity));
  if (opts?.tool) conditions.push(eq(findings.tool, opts.tool));

  const whereClause = and(...conditions);
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
    .from(findings).where(whereClause);

  const results = await db.select().from(findings)
    .where(whereClause)
    .orderBy(desc(findings.createdAt))
    .limit(limit)
    .offset(offset);

  return { count: countResult.count, results };
}

export async function listFindingsByTest(testId: number): Promise<Finding[]> {
  return db.select().from(findings)
    .where(eq(findings.testId, testId))
    .orderBy(
      sql`CASE ${findings.severity}
        WHEN 'Critical' THEN 0
        WHEN 'High' THEN 1
        WHEN 'Medium' THEN 2
        WHEN 'Low' THEN 3
        WHEN 'Info' THEN 4
        ELSE 5
      END`,
      findings.title,
    );
}

export async function riskAcceptFinding(findingId: number, reason: string): Promise<Finding> {
  const [row] = await db.update(findings)
    .set({
      status: 'risk_accepted',
      riskAcceptedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(findings.id, findingId))
    .returning();
  return row;
}

export async function falsePositiveFinding(findingId: number, reason: string): Promise<Finding> {
  const [row] = await db.update(findings)
    .set({
      status: 'false_positive',
      riskAcceptedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(findings.id, findingId))
    .returning();
  return row;
}

export async function duplicateFinding(findingId: number, reason: string): Promise<Finding> {
  const [row] = await db.update(findings)
    .set({
      status: 'duplicate',
      riskAcceptedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(findings.id, findingId))
    .returning();
  return row;
}

// ── Finding Notes ──────────────────────────────────────────────

export async function addFindingNote(data: {
  findingId: number;
  author?: string;
  noteType?: string;
  content: string;
}): Promise<FindingNote> {
  const [row] = await db.insert(findingNotes).values({
    findingId: data.findingId,
    author: data.author ?? 'system',
    noteType: data.noteType ?? 'comment',
    content: data.content,
  }).returning();
  return row;
}

export async function getFindingNotes(findingId: number): Promise<FindingNote[]> {
  return db.select().from(findingNotes)
    .where(eq(findingNotes.findingId, findingId))
    .orderBy(findingNotes.createdAt);
}

// ── Scan Files ─────────────────────────────────────────────────

export async function addScanFile(data: {
  scanId: string;
  fileName: string;
  fileType?: string;
  filePath?: string;
  content?: string;
}): Promise<ScanFile> {
  const [row] = await db.insert(scanFiles).values({
    scanId: data.scanId,
    fileName: data.fileName,
    fileType: data.fileType ?? null,
    filePath: data.filePath ?? null,
    content: data.content ?? null,
  }).returning();
  return row;
}

export async function getScanFiles(scanId: string): Promise<ScanFile[]> {
  return db.select().from(scanFiles)
    .where(eq(scanFiles.scanId, scanId))
    .orderBy(scanFiles.createdAt);
}

// ── Scan Notes ─────────────────────────────────────────────────

export async function addScanNote(data: {
  scanId: string;
  author?: string;
  content: string;
}): Promise<ScanNote> {
  const [row] = await db.insert(scanNotes).values({
    scanId: data.scanId,
    author: data.author ?? 'system',
    content: data.content,
  }).returning();
  return row;
}

export async function getScanNotes(scanId: string): Promise<ScanNote[]> {
  return db.select().from(scanNotes)
    .where(eq(scanNotes.scanId, scanId))
    .orderBy(scanNotes.createdAt);
}

// ── Users ───────────────────────────────────────────────────────

export async function createUser(data: {
  username: string;
  passwordHash: string;
  displayName?: string;
  role?: string;
  mustChangePassword?: boolean;
}): Promise<User> {
  const [row] = await db.insert(users).values({
    username: data.username,
    passwordHash: data.passwordHash,
    displayName: data.displayName ?? null,
    role: data.role ?? 'user',
    mustChangePassword: data.mustChangePassword ?? false,
  }).returning();
  return row;
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.username, username));
  return rows[0] ?? null;
}

export async function countUsers(): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return result.count;
}

// ── Sessions ────────────────────────────────────────────────────

export async function createSession(userId: number, ttlHours = 168): Promise<Session> {
  const token = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const [row] = await db.insert(sessions).values({
    userId,
    token,
    expiresAt,
  }).returning();
  return row;
}

export async function findSessionByToken(token: string): Promise<(Session & { username: string; role: string; displayName: string | null; mustChangePassword: boolean }) | null> {
  const rows = await db.select({
    id: sessions.id,
    userId: sessions.userId,
    token: sessions.token,
    createdAt: sessions.createdAt,
    expiresAt: sessions.expiresAt,
    username: users.username,
    displayName: users.displayName,
    role: users.role,
    mustChangePassword: users.mustChangePassword,
  }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.token, token),
      sql`${sessions.expiresAt} > NOW()`,
    ));
  return (rows[0] as any) ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(sql`${sessions.expiresAt} < NOW()`);
}

// ── Workspace Members ───────────────────────────────────────

export async function addWorkspaceMember(data: {
  userId: number;
  workspaceId: number;
  role: string;
}): Promise<WorkspaceMember> {
  const [row] = await db.insert(workspaceMembers).values({
    userId: data.userId,
    workspaceId: data.workspaceId,
    role: data.role,
  }).returning();
  return row;
}

export async function getWorkspaceMember(
  userId: number,
  workspaceId: number,
): Promise<WorkspaceMember | null> {
  const rows = await db.select().from(workspaceMembers).where(
    and(
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.workspaceId, workspaceId),
    ),
  );
  return rows[0] ?? null;
}

export async function listWorkspaceMembers(workspaceId: number): Promise<Array<WorkspaceMember & { username: string; displayName: string | null }>> {
  return db.select({
    id: workspaceMembers.id,
    userId: workspaceMembers.userId,
    workspaceId: workspaceMembers.workspaceId,
    role: workspaceMembers.role,
    createdAt: workspaceMembers.createdAt,
    username: users.username,
    displayName: users.displayName,
  }).from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
}

export async function listUserWorkspaces(userId: number): Promise<Array<WorkspaceMember & { name: string; description: string | null; defaultLanguage: string | null }>> {
  return db.select({
    id: workspaceMembers.id,
    userId: workspaceMembers.userId,
    workspaceId: workspaceMembers.workspaceId,
    role: workspaceMembers.role,
    createdAt: workspaceMembers.createdAt,
    name: workspaces.name,
    description: workspaces.description,
    defaultLanguage: workspaces.defaultLanguage,
  }).from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId));
}

export async function removeWorkspaceMember(
  userId: number,
  workspaceId: number,
): Promise<void> {
  await db.delete(workspaceMembers).where(
    and(
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.workspaceId, workspaceId),
    ),
  );
}

export async function updateMemberRole(
  userId: number,
  workspaceId: number,
  role: string,
): Promise<WorkspaceMember | null> {
  const rows = await db.update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function countWorkspaceAdmins(workspaceId: number): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, 'workspace_admin'),
      ),
    );
  return result.count;
}

export async function countSuperAdmins(): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.role, 'super_admin'));
  return result.count;
}

export async function findUserById(id: number): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}

export async function listAllUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.createdAt));
}

export async function deleteUser(id: number): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

export async function updateUser(id: number, data: { displayName?: string; passwordHash?: string; mustChangePassword?: boolean }): Promise<User | null> {
  const rows = await db.update(users)
    .set(data)
    .where(eq(users.id, id))
    .returning();
  return rows[0] ?? null;
}

// ── Sources (was git integrations) ──────────────────────────

export async function createSource(data: {
  workspaceId: number;
  provider: string;
  baseUrl: string;
  orgName?: string;
  orgType?: string;
  syncIntervalMinutes?: number;
}): Promise<Source> {
  const [row] = await db.insert(sources).values({
    workspaceId: data.workspaceId,
    provider: data.provider,
    baseUrl: data.baseUrl,
    orgName: data.orgName ?? null,
    orgType: data.orgType ?? null,
    syncIntervalMinutes: data.syncIntervalMinutes ?? 60,
  }).returning();
  return row;
}

export async function getSource(id: number): Promise<Source | null> {
  const rows = await db.select().from(sources).where(eq(sources.id, id));
  return rows[0] ?? null;
}

export async function listSources(workspaceId: number): Promise<Source[]> {
  return db.select().from(sources)
    .where(eq(sources.workspaceId, workspaceId))
    .orderBy(sources.createdAt);
}

export async function updateSource(id: number, data: {
  syncIntervalMinutes?: number;
  lastSyncedAt?: string;
  prCommentsEnabled?: boolean;
  detectedScopes?: string[];
  webhookId?: string;
  credentialType?: string;
  credentialUsername?: string | null;
  tokenExpiresAt?: string | null;
}): Promise<Source | null> {
  const setObj: Record<string, unknown> = {};
  if (data.syncIntervalMinutes !== undefined) setObj.syncIntervalMinutes = data.syncIntervalMinutes;
  if (data.lastSyncedAt !== undefined) setObj.lastSyncedAt = new Date(data.lastSyncedAt);
  if (data.prCommentsEnabled !== undefined) setObj.prCommentsEnabled = data.prCommentsEnabled;
  if (data.detectedScopes !== undefined) setObj.detectedScopes = data.detectedScopes;
  if (data.webhookId !== undefined) setObj.webhookId = data.webhookId;
  if (data.credentialType !== undefined) setObj.credentialType = data.credentialType;
  if (data.credentialUsername !== undefined) setObj.credentialUsername = data.credentialUsername;
  if (data.tokenExpiresAt !== undefined) setObj.tokenExpiresAt = data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null;

  if (Object.keys(setObj).length === 0) return getSource(id);

  const rows = await db.update(sources)
    .set(setObj)
    .where(eq(sources.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteSource(id: number): Promise<void> {
  await deleteOwnerSecrets('source', id);
  await db.delete(sources).where(eq(sources.id, id));
}

// ── Workspace Events ─────────────────────────────────────────

export async function createWorkspaceEvent(
  workspaceId: number,
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<WorkspaceEvent> {
  const [row] = await db.insert(workspaceEvents).values({
    workspaceId,
    eventType,
    payload,
  }).returning();
  return row;
}

export async function listWorkspaceEvents(
  workspaceId: number,
  opts?: { limit?: number; offset?: number; eventType?: string },
): Promise<{ count: number; results: WorkspaceEvent[] }> {
  const conditions: SQL[] = [eq(workspaceEvents.workspaceId, workspaceId)];

  if (opts?.eventType) {
    conditions.push(eq(workspaceEvents.eventType, opts.eventType));
  }

  const whereClause = and(...conditions);
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
    .from(workspaceEvents).where(whereClause);

  const results = await db.select().from(workspaceEvents)
    .where(whereClause)
    .orderBy(desc(workspaceEvents.createdAt))
    .limit(limit)
    .offset(offset);

  return { count: countResult.count, results };
}

// ── Pull Requests ─────────────────────────────────────────

export async function createPullRequest(data: {
  repositoryId: number;
  workspaceId: number;
  externalId: number;
  title: string;
  description?: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  status: string;
  prUrl: string;
}): Promise<PullRequest> {
  const [row] = await db.insert(pullRequests).values({
    repositoryId: data.repositoryId,
    workspaceId: data.workspaceId,
    externalId: data.externalId,
    title: data.title,
    description: data.description ?? null,
    author: data.author,
    sourceBranch: data.sourceBranch,
    targetBranch: data.targetBranch,
    status: data.status,
    prUrl: data.prUrl,
  }).returning();
  return row;
}

export async function getPullRequest(id: number): Promise<PullRequest | null> {
  const rows = await db.select().from(pullRequests).where(eq(pullRequests.id, id));
  return rows[0] ?? null;
}

export async function listPullRequestsByRepository(repositoryId: number): Promise<PullRequest[]> {
  return db.select().from(pullRequests)
    .where(eq(pullRequests.repositoryId, repositoryId))
    .orderBy(desc(pullRequests.updatedAt));
}

export async function upsertPullRequest(data: {
  repositoryId: number;
  workspaceId: number;
  externalId: number;
  title: string;
  description?: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  status: string;
  prUrl: string;
}): Promise<PullRequest> {
  const existing = await db.select().from(pullRequests)
    .where(and(
      eq(pullRequests.repositoryId, data.repositoryId),
      eq(pullRequests.externalId, data.externalId),
    ))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db.update(pullRequests)
      .set({
        title: data.title,
        description: data.description ?? null,
        author: data.author,
        sourceBranch: data.sourceBranch,
        targetBranch: data.targetBranch,
        status: data.status,
        prUrl: data.prUrl,
        updatedAt: new Date(),
      })
      .where(eq(pullRequests.id, existing[0].id))
      .returning();
    return updated;
  }

  return createPullRequest(data);
}

// ── Workspace Tools ──────────────────────────────────────────

export async function getWorkspaceTools(workspaceId: number) {
  const rows = await db.select({
    toolKey: workspaceTools.toolKey,
    enabled: workspaceTools.enabled,
  }).from(workspaceTools).where(eq(workspaceTools.workspaceId, workspaceId));

  // Auto-insert recommended tools that don't have rows yet
  const existingKeys = new Set(rows.map(r => r.toolKey));
  const allTools = getAllToolKeys();
  const recommended = getRecommendedToolKeys();
  const missing = allTools.filter(k => !existingKeys.has(k));

  if (missing.length > 0) {
    const newRows = missing.map(k => ({
      workspaceId,
      toolKey: k,
      enabled: recommended.includes(k),
    }));
    await db.insert(workspaceTools).values(newRows).onConflictDoNothing();
    rows.push(...newRows.map(r => ({ toolKey: r.toolKey, enabled: r.enabled })));
  }

  return rows;
}

export async function setWorkspaceTools(
  workspaceId: number,
  tools: { toolKey: string; enabled: boolean }[]
) {
  const validKeys = getAllToolKeys();
  for (const { toolKey, enabled } of tools) {
    if (!validKeys.includes(toolKey)) {
      throw new Error(`Invalid tool key: ${toolKey}`);
    }
    await db.insert(workspaceTools)
      .values({ workspaceId, toolKey, enabled })
      .onConflictDoUpdate({
        target: [workspaceTools.workspaceId, workspaceTools.toolKey],
        set: { enabled, updatedAt: new Date() },
      });
  }
}

export async function initDefaultTools(workspaceId: number) {
  const recommended = getRecommendedToolKeys();
  await db.insert(workspaceTools)
    .values(recommended.map(toolKey => ({ workspaceId, toolKey, enabled: true })))
    .onConflictDoNothing();
}
