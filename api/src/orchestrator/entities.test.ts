import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { db } from '../db/index.ts';
import { getSecret, deleteOwnerSecrets } from '../lib/vault.ts';

vi.mock('../lib/vault.ts', () => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteOwnerSecrets: vi.fn(),
  deleteSecret: vi.fn(),
}));

// ── Shared mock setup ──────────────────────────────────────────────

const mockDb = db as any;

function resetMockDb() {
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
  if (typeof mockDb.mockReset === 'function') mockDb.mockReset();
}

beforeEach(() => {
  resetMockDb();
  vi.mocked(getSecret).mockReset();
  vi.mocked(deleteOwnerSecrets).mockReset();
});

async function entities() {
  return import('./entities.ts');
}

// ── Mock helpers ─────────────────────────────────────────────────

function mockInsertReturning(returnValue: unknown[]) {
  mockDb.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnValue),
    }),
  });
}

function mockSelectFromWhere(returnValue: unknown[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(returnValue),
    }),
  });
}

function mockSelectFromOrderBy(returnValue: unknown[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockResolvedValue(returnValue),
    }),
  });
}

function mockSelectFromWhereOrderBy(returnValue: unknown[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(returnValue),
      }),
    }),
  });
}

function mockUpdateSetWhereReturning(returnValue: unknown[]) {
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returnValue),
      }),
    }),
  });
}

function mockUpdateSetWhere() {
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

function mockDeleteWhere() {
  mockDb.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
}

// ── computeFingerprint ─────────────────────────────────────────────

describe('computeFingerprint', () => {
  it('returns a 40-char hex string', async () => {
    const { computeFingerprint } = await entities();
    const fp = computeFingerprint('gitleaks', 'src/index.ts', 42, 'CVE-2021-1234', 'Secret detected');
    expect(fp).toMatch(/^[0-9a-f]{40}$/);
  });

  it('produces consistent output for same inputs', async () => {
    const { computeFingerprint } = await entities();
    const a = computeFingerprint('gitleaks', 'a.ts', 1, 'V1', 'Title');
    const b = computeFingerprint('gitleaks', 'a.ts', 1, 'V1', 'Title');
    expect(a).toBe(b);
  });

  it('produces different output for different tools', async () => {
    const { computeFingerprint } = await entities();
    const a = computeFingerprint('gitleaks', 'a.ts', 1, 'V1', 'T');
    const b = computeFingerprint('trivy', 'a.ts', 1, 'V1', 'T');
    expect(a).not.toBe(b);
  });

  it('produces different output for different file paths', async () => {
    const { computeFingerprint } = await entities();
    const a = computeFingerprint('gitleaks', 'a.ts', 1, 'V1', 'T');
    const b = computeFingerprint('gitleaks', 'b.ts', 1, 'V1', 'T');
    expect(a).not.toBe(b);
  });

  it('produces different output for different lines', async () => {
    const { computeFingerprint } = await entities();
    const a = computeFingerprint('gitleaks', 'a.ts', 1, 'V1', 'T');
    const b = computeFingerprint('gitleaks', 'a.ts', 2, 'V1', 'T');
    expect(a).not.toBe(b);
  });

  it('produces different output for different vulnIds', async () => {
    const { computeFingerprint } = await entities();
    const a = computeFingerprint('gitleaks', 'a.ts', 1, 'V1', 'T');
    const b = computeFingerprint('gitleaks', 'a.ts', 1, 'V2', 'T');
    expect(a).not.toBe(b);
  });

  it('produces different output for different titles', async () => {
    const { computeFingerprint } = await entities();
    const a = computeFingerprint('gitleaks', 'a.ts', 1, 'V1', 'Title A');
    const b = computeFingerprint('gitleaks', 'a.ts', 1, 'V1', 'Title B');
    expect(a).not.toBe(b);
  });

  it('handles null/undefined inputs by replacing with empty string', async () => {
    const { computeFingerprint } = await entities();
    const withNulls = computeFingerprint(null, null, null, null, null);
    const withUndefined = computeFingerprint(undefined, undefined, undefined, undefined, undefined);
    expect(withNulls).toBe(withUndefined);
    const expected = createHash('sha256').update('||||').digest('hex').slice(0, 40);
    expect(withNulls).toBe(expected);
  });

  it('uses pipe-separated concatenation for hashing', async () => {
    const { computeFingerprint } = await entities();
    const fp = computeFingerprint('tool', 'path', 10, 'vuln', 'title');
    const expected = createHash('sha256').update('tool|path|10|vuln|title').digest('hex').slice(0, 40);
    expect(fp).toBe(expected);
  });

  it('converts line number to string in hash input', async () => {
    const { computeFingerprint } = await entities();
    const fp = computeFingerprint('t', 'p', 0, 'v', 'tt');
    const expected = createHash('sha256').update('t|p|0|v|tt').digest('hex').slice(0, 40);
    expect(fp).toBe(expected);
  });
});

// ── Workspaces ─────────────────────────────────────────────────────

describe('createWorkspace', () => {
  it('inserts a workspace with name and description', async () => {
    const row = { id: 1, name: 'ws1', description: 'desc' };
    mockInsertReturning([row]);

    const { createWorkspace } = await entities();
    const result = await createWorkspace('ws1', 'desc');

    expect(result).toEqual(row);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('defaults description to null when omitted', async () => {
    const row = { id: 2, name: 'ws2', description: null };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createWorkspace } = await entities();
    await createWorkspace('ws2');

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      name: 'ws2',
      description: null,
    }));
  });
});

describe('getWorkspace', () => {
  it('returns workspace when found', async () => {
    const row = { id: 1, name: 'ws1' };
    mockSelectFromWhere([row]);

    const { getWorkspace } = await entities();
    const result = await getWorkspace(1);
    expect(result).toEqual(row);
  });

  it('returns null when workspace not found', async () => {
    mockSelectFromWhere([]);

    const { getWorkspace } = await entities();
    const result = await getWorkspace(999);
    expect(result).toBeNull();
  });
});

describe('findWorkspaceByName', () => {
  it('returns workspace when found by name', async () => {
    const row = { id: 1, name: 'ws1' };
    mockSelectFromWhere([row]);

    const { findWorkspaceByName } = await entities();
    const result = await findWorkspaceByName('ws1');
    expect(result).toEqual(row);
  });

  it('returns null when not found', async () => {
    mockSelectFromWhere([]);

    const { findWorkspaceByName } = await entities();
    const result = await findWorkspaceByName('missing');
    expect(result).toBeNull();
  });
});

describe('listWorkspaces', () => {
  it('returns all workspaces ordered by created_at', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockSelectFromOrderBy(rows);

    const { listWorkspaces } = await entities();
    const result = await listWorkspaces();
    expect(result).toEqual(rows);
  });
});

describe('ensureWorkspace', () => {
  it('returns existing workspace when found by name', async () => {
    const existing = { id: 1, name: 'ws1' };
    mockSelectFromWhere([existing]);

    const { ensureWorkspace } = await entities();
    const result = await ensureWorkspace('ws1');

    expect(result).toEqual(existing);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates new workspace when not found', async () => {
    const created = { id: 2, name: 'ws2' };
    // findWorkspaceByName returns empty
    mockSelectFromWhere([]);

    const { ensureWorkspace } = await entities();
    // After select returns empty, createWorkspace will be called
    // Override insert mock for the create call
    mockInsertReturning([created]);
    const result = await ensureWorkspace('ws2');

    expect(result).toEqual(created);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

// ── Teams ──────────────────────────────────────────────────────────

describe('createTeam', () => {
  it('inserts a team with workspace_id, name, and description', async () => {
    const row = { id: 1, workspaceId: 10, name: 'team1', description: 'desc' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createTeam } = await entities();
    const result = await createTeam(10, 'team1', 'desc');

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 10,
      name: 'team1',
      description: 'desc',
    }));
  });

  it('defaults description to null when omitted', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createTeam } = await entities();
    await createTeam(10, 'team2');

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      description: null,
    }));
  });
});

describe('ensureTeam', () => {
  it('returns existing team when found', async () => {
    const existing = { id: 1, workspaceId: 10, name: 'team1' };
    mockSelectFromWhere([existing]);

    const { ensureTeam } = await entities();
    const result = await ensureTeam(10, 'team1');

    expect(result).toEqual(existing);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates new team when not found', async () => {
    const created = { id: 2, workspaceId: 10, name: 'team2' };
    mockSelectFromWhere([]);
    mockInsertReturning([created]);

    const { ensureTeam } = await entities();
    const result = await ensureTeam(10, 'team2');

    expect(result).toEqual(created);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

// ── Repositories ───────────────────────────────────────────────────

describe('createRepository', () => {
  it('inserts a repository with team_id, name, and repo_url', async () => {
    const row = { id: 1, teamId: 5, name: 'repo1', repoUrl: 'https://example.com' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createRepository } = await entities();
    const result = await createRepository(5, 'repo1', 'https://example.com');

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 5,
      name: 'repo1',
      repoUrl: 'https://example.com',
    }));
  });

  it('defaults repo_url to null when omitted', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createRepository } = await entities();
    await createRepository(5, 'repo2');

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      repoUrl: null,
    }));
  });
});

describe('ensureRepository', () => {
  it('returns existing repository when found by teamId and name', async () => {
    const existing = { id: 1, teamId: 5, name: 'repo1' };
    mockSelectFromWhere([existing]);

    const { ensureRepository } = await entities();
    const result = await ensureRepository(5, 'repo1');

    expect(result).toEqual(existing);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates new repository when not found', async () => {
    const created = { id: 2, teamId: 5, name: 'repo2', repoUrl: 'https://x.com' };
    mockSelectFromWhere([]);
    mockInsertReturning([created]);

    const { ensureRepository } = await entities();
    const result = await ensureRepository(5, 'repo2', 'https://x.com');

    expect(result).toEqual(created);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

// ── getRepoCloneCredentials ───────────────────────────────────────

describe('getRepoCloneCredentials', () => {
  it('returns provider, token, and email when repo has linked source with vault secret', async () => {
    let selectCallNum = 0;
    mockDb.select.mockImplementation(() => {
      selectCallNum++;
      if (selectCallNum === 1) {
        // First call: repository lookup → returns sourceId
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ sourceId: 5 }]),
            }),
          }),
        };
      }
      // Second call: source lookup → returns provider + credentialUsername
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ provider: 'bitbucket', credentialUsername: 'user@email.com' }]),
          }),
        }),
      };
    });
    (getSecret as any).mockResolvedValue('secret-token-123');

    const { getRepoCloneCredentials } = await entities();
    const result = await getRepoCloneCredentials('my-repo', 'https://bitbucket.org/org/my-repo');

    expect(result).toEqual({
      provider: 'bitbucket',
      token: 'secret-token-123',
      email: 'user@email.com',
    });
    expect(getSecret).toHaveBeenCalledWith('source', 5, 'access_token');
  });

  it('returns null when repository has no linked source', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ sourceId: null }]),
        }),
      }),
    });

    const { getRepoCloneCredentials } = await entities();
    const result = await getRepoCloneCredentials('orphan-repo');

    expect(result).toBeNull();
  });

  it('returns null when repository is not found', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const { getRepoCloneCredentials } = await entities();
    const result = await getRepoCloneCredentials('nonexistent-repo');

    expect(result).toBeNull();
  });

  it('returns null when source is not found', async () => {
    let selectCallNum = 0;
    mockDb.select.mockImplementation(() => {
      selectCallNum++;
      if (selectCallNum === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ sourceId: 99 }]),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
    });

    const { getRepoCloneCredentials } = await entities();
    const result = await getRepoCloneCredentials('repo-with-missing-source');

    expect(result).toBeNull();
  });

  it('returns null when vault has no access_token secret', async () => {
    let selectCallNum = 0;
    mockDb.select.mockImplementation(() => {
      selectCallNum++;
      if (selectCallNum === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ sourceId: 5 }]),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ provider: 'github', credentialUsername: null }]),
          }),
        }),
      };
    });
    (getSecret as any).mockResolvedValue(null);

    const { getRepoCloneCredentials } = await entities();
    const result = await getRepoCloneCredentials('repo-no-token');

    expect(result).toBeNull();
  });

  it('returns email as undefined when credentialUsername is null', async () => {
    let selectCallNum = 0;
    mockDb.select.mockImplementation(() => {
      selectCallNum++;
      if (selectCallNum === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ sourceId: 5 }]),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ provider: 'github', credentialUsername: null }]),
          }),
        }),
      };
    });
    (getSecret as any).mockResolvedValue('tok-abc');

    const { getRepoCloneCredentials } = await entities();
    const result = await getRepoCloneCredentials('repo-no-email');

    expect(result).toEqual({
      provider: 'github',
      token: 'tok-abc',
      email: undefined,
    });
  });
});

// ── Tests ──────────────────────────────────────────────────────────

describe('createTest', () => {
  it('inserts a test with all fields', async () => {
    const row = { id: 1, scanId: 'scan-1', tool: 'gitleaks', scanType: 'sast' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createTest } = await entities();
    const result = await createTest({
      scanId: 'scan-1',
      tool: 'gitleaks',
      scanType: 'sast',
      testTitle: 'Test Title',
      fileName: 'results.json',
    });

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      tool: 'gitleaks',
      scanType: 'sast',
      testTitle: 'Test Title',
      fileName: 'results.json',
    }));
  });

  it('defaults optional fields to null', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createTest } = await entities();
    await createTest({ scanId: 'scan-2', tool: 'trivy', scanType: 'sca' });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      testTitle: null,
      fileName: null,
    }));
  });
});

describe('updateTestFindingsCount', () => {
  it('updates findings_count and sets import_status to completed', async () => {
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { updateTestFindingsCount } = await entities();
    await updateTestFindingsCount(42, 15);

    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      findingsCount: 15,
      importStatus: 'completed',
    }));
  });
});

// ── Findings ───────────────────────────────────────────────────────

describe('createFinding', () => {
  it('computes fingerprint and inserts finding', async () => {
    const row = { id: 1, title: 'Secret found' };
    mockInsertReturning([row]);

    const { createFinding } = await entities();
    const result = await createFinding({
      testId: 10,
      repositoryId: 20,
      title: 'Secret found',
      severity: 'High',
      description: 'A secret was found',
      filePath: 'src/index.ts',
      line: 42,
      vulnIdFromTool: 'CVE-123',
      cwe: 798,
      cvssScore: 8.5,
      tool: 'gitleaks',
    });

    expect(result).toEqual(row);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('defaults optional fields to null', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createFinding } = await entities();
    await createFinding({
      testId: 10,
      title: 'Finding',
      severity: 'Low',
      tool: 'beast',
    });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      repositoryId: null,
      description: null,
      filePath: null,
      line: null,
      vulnIdFromTool: null,
      cwe: null,
      cvssScore: null,
    }));
  });

  it('normalizes lowercase severity to PascalCase', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 3 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createFinding } = await entities();
    await createFinding({
      testId: 10,
      title: 'Finding',
      severity: 'high',
      tool: 'beast',
    });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'High',
    }));
  });

  it('falls back to Info for unknown severity', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 4 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createFinding } = await entities();
    await createFinding({
      testId: 10,
      title: 'Finding',
      severity: 'banana',
      tool: 'beast',
    });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'Info',
    }));
  });
});

describe('upsertFinding', () => {
  it('updates existing finding when fingerprint matches and repositoryId is provided', async () => {
    const existing = { id: 100, fingerprint: 'abc' };
    const updated = { id: 100, severity: 'Critical', status: 'open' };

    // SELECT (fingerprint lookup)
    mockSelectFromWhere([existing]);
    // UPDATE
    mockUpdateSetWhereReturning([updated]);

    const { upsertFinding } = await entities();
    const result = await upsertFinding({
      testId: 5,
      repositoryId: 20,
      title: 'T',
      severity: 'Critical',
      description: 'desc',
      filePath: 'f.ts',
      line: 1,
      vulnIdFromTool: 'V',
      tool: 'gitleaks',
    });

    expect(result).toEqual(updated);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('creates new finding when fingerprint does not match', async () => {
    const created = { id: 200, title: 'New' };
    // SELECT returns empty
    mockSelectFromWhere([]);
    // createFinding INSERT
    mockInsertReturning([created]);

    const { upsertFinding } = await entities();
    const result = await upsertFinding({
      testId: 5,
      repositoryId: 20,
      title: 'New',
      severity: 'Low',
      tool: 'trivy',
    });

    expect(result).toEqual(created);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('skips fingerprint lookup when repositoryId is not provided', async () => {
    const created = { id: 300 };
    mockInsertReturning([created]);

    const { upsertFinding } = await entities();
    const result = await upsertFinding({
      testId: 5,
      title: 'NoRepo',
      severity: 'Medium',
      tool: 'beast',
    });

    expect(result).toEqual(created);
    // No SELECT for fingerprint lookup
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

describe('listFindingsByRepository', () => {
  function setupListMock(countVal: number, rows: unknown[]) {
    let callNum = 0;
    mockDb.select.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: countVal }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(rows),
              }),
            }),
          }),
        }),
      };
    });
  }

  it('queries with repository_id only (no filters)', async () => {
    setupListMock(2, [{ id: 1 }, { id: 2 }]);

    const { listFindingsByRepository } = await entities();
    const result = await listFindingsByRepository(10);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  it('returns correct count with filters', async () => {
    setupListMock(1, [{ id: 1 }]);

    const { listFindingsByRepository } = await entities();
    const result = await listFindingsByRepository(10, { status: 'open' });

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it('combines multiple filters', async () => {
    setupListMock(0, []);

    const { listFindingsByRepository } = await entities();
    const result = await listFindingsByRepository(10, { status: 'open', severity: 'Critical', tool: 'gitleaks' });

    expect(result.count).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('respects custom limit and offset', async () => {
    setupListMock(50, []);

    const { listFindingsByRepository } = await entities();
    const result = await listFindingsByRepository(10, { limit: 25, offset: 50 });

    expect(result.count).toBe(50);
  });
});

describe('riskAcceptFinding', () => {
  it('updates finding status to risk_accepted', async () => {
    const row = { id: 5, status: 'risk_accepted' };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { riskAcceptFinding } = await entities();
    const result = await riskAcceptFinding(5, 'Known risk');

    expect(result).toEqual(row);
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      status: 'risk_accepted',
      riskAcceptedReason: 'Known risk',
    }));
    expect(setFn).toHaveBeenCalledWith(expect.not.objectContaining({
      active: expect.anything(),
      riskAccepted: expect.anything(),
    }));
  });
});

// ── Finding Notes ──────────────────────────────────────────────────

describe('addFindingNote', () => {
  it('inserts a finding note with all fields', async () => {
    const row = { id: 1, findingId: 10, author: 'admin', noteType: 'triage', content: 'Reviewed' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { addFindingNote } = await entities();
    const result = await addFindingNote({
      findingId: 10,
      author: 'admin',
      noteType: 'triage',
      content: 'Reviewed',
    });

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      findingId: 10,
      author: 'admin',
      noteType: 'triage',
      content: 'Reviewed',
    }));
  });

  it('defaults author to "system" and noteType to "comment"', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { addFindingNote } = await entities();
    await addFindingNote({ findingId: 10, content: 'Auto note' });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      author: 'system',
      noteType: 'comment',
    }));
  });
});

describe('getFindingNotes', () => {
  it('returns notes ordered by created_at', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockSelectFromWhereOrderBy(rows);

    const { getFindingNotes } = await entities();
    const result = await getFindingNotes(10);

    expect(result).toEqual(rows);
  });
});

// ── Scan Files ─────────────────────────────────────────────────────

describe('addScanFile', () => {
  it('inserts a scan file with all fields', async () => {
    const row = { id: 1, scanId: 'scan-1', fileName: 'report.md' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { addScanFile } = await entities();
    const result = await addScanFile({
      scanId: 'scan-1',
      fileName: 'report.md',
      fileType: 'markdown',
      filePath: '/tmp/report.md',
      content: '# Report',
    });

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      fileName: 'report.md',
      fileType: 'markdown',
      filePath: '/tmp/report.md',
      content: '# Report',
    }));
  });

  it('defaults optional fields to null', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { addScanFile } = await entities();
    await addScanFile({ scanId: 'scan-1', fileName: 'file.json' });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      fileType: null,
      filePath: null,
      content: null,
    }));
  });
});

// ── Scan Notes ─────────────────────────────────────────────────────

describe('addScanNote', () => {
  it('inserts a scan note with author', async () => {
    const row = { id: 1, scanId: 'scan-1', author: 'admin', content: 'Note' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { addScanNote } = await entities();
    const result = await addScanNote({
      scanId: 'scan-1',
      author: 'admin',
      content: 'Note',
    });

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      author: 'admin',
    }));
  });

  it('defaults author to "system"', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { addScanNote } = await entities();
    await addScanNote({ scanId: 'scan-1', content: 'Auto' });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      author: 'system',
    }));
  });
});

// ── Users ──────────────────────────────────────────────────────────

describe('createUser', () => {
  it('inserts a user with all fields', async () => {
    const row = { id: 1, username: 'admin', role: 'admin' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createUser } = await entities();
    const result = await createUser({
      username: 'admin',
      passwordHash: 'hash123',
      displayName: 'Admin User',
      role: 'admin',
    });

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      username: 'admin',
      passwordHash: 'hash123',
      displayName: 'Admin User',
      role: 'admin',
    }));
  });

  it('defaults displayName to null and role to "user"', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createUser } = await entities();
    await createUser({ username: 'dev', passwordHash: 'pw' });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      displayName: null,
      role: 'user',
    }));
  });
});

describe('countUsers', () => {
  it('returns user count as a number', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockResolvedValue([{ count: 5 }]),
    });

    const { countUsers } = await entities();
    const result = await countUsers();
    expect(result).toBe(5);
  });

  it('returns 0 when no users', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockResolvedValue([{ count: 0 }]),
    });

    const { countUsers } = await entities();
    const result = await countUsers();
    expect(result).toBe(0);
  });
});

describe('findUserByUsername', () => {
  it('returns user when found', async () => {
    const row = { id: 1, username: 'admin' };
    mockSelectFromWhere([row]);

    const { findUserByUsername } = await entities();
    const result = await findUserByUsername('admin');
    expect(result).toEqual(row);
  });

  it('returns null when user not found', async () => {
    mockSelectFromWhere([]);

    const { findUserByUsername } = await entities();
    const result = await findUserByUsername('ghost');
    expect(result).toBeNull();
  });
});

// ── Sessions ───────────────────────────────────────────────────────

describe('createSession', () => {
  it('generates a hex token and inserts a session', async () => {
    const row = { id: 1, userId: 42, token: 'abc123' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createSession } = await entities();
    const result = await createSession(42);

    expect(result).toEqual(row);

    const values = valuesFn.mock.calls[0][0];
    expect(values.userId).toBe(42);
    // token is a 96-char hex string from 48 random bytes
    expect(values.token).toMatch(/^[0-9a-f]{96}$/);
    // expiresAt is a Date in the future
    expect(values.expiresAt).toBeInstanceOf(Date);
    expect(values.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('respects custom TTL in hours', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createSession } = await entities();
    const before = Date.now();
    await createSession(42, 1);

    const values = valuesFn.mock.calls[0][0];
    const expiresAt = values.expiresAt.getTime();
    const oneHourMs = 1 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + oneHourMs - 5000);
    expect(expiresAt).toBeLessThanOrEqual(before + oneHourMs + 5000);
  });

  it('defaults TTL to 168 hours (7 days)', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 3 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createSession } = await entities();
    const before = Date.now();
    await createSession(42);

    const values = valuesFn.mock.calls[0][0];
    const expiresAt = values.expiresAt.getTime();
    const sevenDaysMs = 168 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + sevenDaysMs - 5000);
    expect(expiresAt).toBeLessThanOrEqual(before + sevenDaysMs + 5000);
  });
});

describe('findSessionByToken', () => {
  it('returns session with user join', async () => {
    const row = { id: 1, token: 'tok', userId: 5, username: 'admin', role: 'admin' };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([row]),
        }),
      }),
    });

    const { findSessionByToken } = await entities();
    const result = await findSessionByToken('tok');
    expect(result).toEqual(row);
  });

  it('returns null when session not found or expired', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const { findSessionByToken } = await entities();
    const result = await findSessionByToken('expired');
    expect(result).toBeNull();
  });
});

describe('deleteSession', () => {
  it('deletes session by token', async () => {
    mockDeleteWhere();

    const { deleteSession } = await entities();
    await deleteSession('tok');
    expect(mockDb.delete).toHaveBeenCalled();
  });
});

// ── Sources ────────────────────────────────────────────────────────

describe('createSource', () => {
  it('inserts a source with all fields', async () => {
    const row = { id: 1, workspaceId: 10, provider: 'github' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createSource } = await entities();
    const result = await createSource({
      workspaceId: 10,
      provider: 'github',
      baseUrl: 'https://github.com',
      orgName: 'my-org',
      orgType: 'org',
      syncIntervalMinutes: 30,
    });

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 10,
      provider: 'github',
      baseUrl: 'https://github.com',
      orgName: 'my-org',
      orgType: 'org',
      syncIntervalMinutes: 30,
    }));
  });

  it('defaults optional fields', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createSource } = await entities();
    await createSource({
      workspaceId: 10,
      provider: 'gitlab',
      baseUrl: 'https://gitlab.com',
    });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      orgName: null,
      orgType: null,
      syncIntervalMinutes: 60,
    }));
  });
});

describe('updateSource', () => {
  it('sets syncIntervalMinutes', async () => {
    const row = { id: 1, syncIntervalMinutes: 120 };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { updateSource } = await entities();
    const result = await updateSource(1, { syncIntervalMinutes: 120 });

    expect(result).toEqual(row);
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      syncIntervalMinutes: 120,
    }));
  });

  it('converts lastSyncedAt string to Date before passing to Drizzle', async () => {
    const row = { id: 1 };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { updateSource } = await entities();
    await updateSource(1, { lastSyncedAt: '2026-01-01T00:00:00Z' });

    const passedArg = setFn.mock.calls[0][0];
    expect(passedArg.lastSyncedAt).toBeInstanceOf(Date);
    expect(passedArg.lastSyncedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('sets prCommentsEnabled', async () => {
    const row = { id: 1, prCommentsEnabled: true };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { updateSource } = await entities();
    const result = await updateSource(1, { prCommentsEnabled: true });

    expect(result).toEqual(row);
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      prCommentsEnabled: true,
    }));
  });

  it('sets detectedScopes array', async () => {
    const scopes = ['repository:read', 'pullrequest:read', 'webhook:read_write'];
    const row = { id: 1, detectedScopes: scopes };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { updateSource } = await entities();
    const result = await updateSource(1, { detectedScopes: scopes });

    expect(result).toEqual(row);
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      detectedScopes: scopes,
    }));
  });

  it('sets credentialType, credentialUsername, and tokenExpiresAt', async () => {
    const row = { id: 1, credentialType: 'pat', credentialUsername: 'user@email.com' };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { updateSource } = await entities();
    const result = await updateSource(1, {
      credentialType: 'pat',
      credentialUsername: 'user@email.com',
      tokenExpiresAt: '2027-06-01T00:00:00Z',
    });

    expect(result).toEqual(row);
    const passedArg = setFn.mock.calls[0][0];
    expect(passedArg.credentialType).toBe('pat');
    expect(passedArg.credentialUsername).toBe('user@email.com');
    expect(passedArg.tokenExpiresAt).toBeInstanceOf(Date);
    expect(passedArg.tokenExpiresAt.toISOString()).toBe('2027-06-01T00:00:00.000Z');
  });

  it('sets tokenExpiresAt to null when passed null', async () => {
    const row = { id: 1 };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { updateSource } = await entities();
    await updateSource(1, { tokenExpiresAt: null });

    const passedArg = setFn.mock.calls[0][0];
    expect(passedArg.tokenExpiresAt).toBeNull();
  });

  it('returns existing source without DB update when no fields provided', async () => {
    const row = { id: 1, provider: 'github' };
    mockSelectFromWhere([row]);

    const { updateSource } = await entities();
    const result = await updateSource(1, {});

    expect(result).toEqual(row);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.select).toHaveBeenCalled();
  });

  it('sets multiple fields in one call', async () => {
    const row = { id: 1, syncIntervalMinutes: 30, prCommentsEnabled: true, webhookId: 'wh-1' };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    const { updateSource } = await entities();
    const result = await updateSource(1, {
      syncIntervalMinutes: 30,
      lastSyncedAt: '2026-06-15T12:00:00Z',
      prCommentsEnabled: true,
      detectedScopes: ['repository:read'],
      webhookId: 'wh-1',
      credentialType: 'pat',
      credentialUsername: 'user@test.com',
    });

    expect(result).toEqual(row);
    const passedArg = setFn.mock.calls[0][0];
    expect(passedArg.syncIntervalMinutes).toBe(30);
    expect(passedArg.lastSyncedAt).toBeInstanceOf(Date);
    expect(passedArg.lastSyncedAt.toISOString()).toBe('2026-06-15T12:00:00.000Z');
    expect(passedArg.prCommentsEnabled).toBe(true);
    expect(passedArg.detectedScopes).toEqual(['repository:read']);
    expect(passedArg.webhookId).toBe('wh-1');
    expect(passedArg.credentialType).toBe('pat');
    expect(passedArg.credentialUsername).toBe('user@test.com');
  });

  it('returns null when UPDATE finds no matching row', async () => {
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const { updateSource } = await entities();
    const result = await updateSource(999, { syncIntervalMinutes: 10 });
    expect(result).toBeNull();
  });
});

describe('deleteSource', () => {
  it('calls deleteOwnerSecrets before deleting source by id', async () => {
    (deleteOwnerSecrets as any).mockResolvedValue(undefined);
    mockDeleteWhere();

    const { deleteSource } = await entities();
    await deleteSource(1);
    expect(deleteOwnerSecrets).toHaveBeenCalledWith('source', 1);
    expect(mockDb.delete).toHaveBeenCalled();
  });
});

// ── Workspace Events ───────────────────────────────────────────────

describe('createWorkspaceEvent', () => {
  it('inserts event with payload', async () => {
    const row = { id: 1, workspaceId: 10, eventType: 'scan.started' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createWorkspaceEvent } = await entities();
    const payload = { scanId: 'abc', repoName: 'test-repo' };
    const result = await createWorkspaceEvent(10, 'scan.started', payload);

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 10,
      eventType: 'scan.started',
      payload,
    }));
  });

  it('defaults payload to empty object when omitted', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createWorkspaceEvent } = await entities();
    await createWorkspaceEvent(10, 'workspace.created');

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      payload: {},
    }));
  });
});

describe('listWorkspaceEvents', () => {
  function setupListMock(countVal: number, rows: unknown[]) {
    let callNum = 0;
    mockDb.select.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: countVal }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(rows),
              }),
            }),
          }),
        }),
      };
    });
  }

  it('returns count and results with defaults', async () => {
    setupListMock(3, [{ id: 1 }, { id: 2 }, { id: 3 }]);

    const { listWorkspaceEvents } = await entities();
    const result = await listWorkspaceEvents(10);

    expect(result.count).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  it('handles eventType filter', async () => {
    setupListMock(1, [{ id: 1 }]);

    const { listWorkspaceEvents } = await entities();
    const result = await listWorkspaceEvents(10, { eventType: 'scan.completed' });

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it('respects custom limit and offset', async () => {
    setupListMock(100, []);

    const { listWorkspaceEvents } = await entities();
    const result = await listWorkspaceEvents(10, { limit: 10, offset: 20 });

    expect(result.count).toBe(100);
  });

  it('combines eventType filter with custom limit/offset', async () => {
    setupListMock(5, []);

    const { listWorkspaceEvents } = await entities();
    const result = await listWorkspaceEvents(10, { eventType: 'scan.started', limit: 5, offset: 10 });

    expect(result.count).toBe(5);
  });
});

// ── Pull Requests ───────────────────────────────────────────────────

describe('createPullRequest', () => {
  it('inserts a pull request with all fields and returns the row', async () => {
    const row = {
      id: 1, repositoryId: 10, workspaceId: 5, externalId: 42,
      title: 'Fix auth bug', author: 'dev1',
      sourceBranch: 'fix/auth', targetBranch: 'main',
      status: 'open', prUrl: 'https://bitbucket.org/org/repo/pull-requests/42',
    };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createPullRequest } = await entities();
    const result = await createPullRequest({
      repositoryId: 10,
      workspaceId: 5,
      externalId: 42,
      title: 'Fix auth bug',
      description: 'Fixes the auth bug',
      author: 'dev1',
      sourceBranch: 'fix/auth',
      targetBranch: 'main',
      status: 'open',
      prUrl: 'https://bitbucket.org/org/repo/pull-requests/42',
    });

    expect(result).toEqual(row);
    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      repositoryId: 10,
      workspaceId: 5,
      externalId: 42,
      title: 'Fix auth bug',
      description: 'Fixes the auth bug',
      author: 'dev1',
      sourceBranch: 'fix/auth',
      targetBranch: 'main',
      status: 'open',
      prUrl: 'https://bitbucket.org/org/repo/pull-requests/42',
    }));
  });

  it('defaults description to null when omitted', async () => {
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 2 }]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    const { createPullRequest } = await entities();
    await createPullRequest({
      repositoryId: 10,
      workspaceId: 5,
      externalId: 99,
      title: 'PR without description',
      author: 'dev2',
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      status: 'open',
      prUrl: 'https://bitbucket.org/org/repo/pull-requests/99',
    });

    expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({
      description: null,
    }));
  });
});

describe('getPullRequest', () => {
  it('returns pull request when found by id', async () => {
    const row = { id: 1, title: 'Fix auth bug' };
    mockSelectFromWhere([row]);

    const { getPullRequest } = await entities();
    const result = await getPullRequest(1);
    expect(result).toEqual(row);
  });

  it('returns null when pull request not found', async () => {
    mockSelectFromWhere([]);

    const { getPullRequest } = await entities();
    const result = await getPullRequest(999);
    expect(result).toBeNull();
  });
});

describe('listPullRequestsByRepository', () => {
  it('returns pull requests ordered by updatedAt desc', async () => {
    const rows = [{ id: 2, title: 'Newer PR' }, { id: 1, title: 'Older PR' }];
    mockSelectFromWhereOrderBy(rows);

    const { listPullRequestsByRepository } = await entities();
    const result = await listPullRequestsByRepository(10);
    expect(result).toEqual(rows);
  });

  it('returns empty array when no pull requests exist', async () => {
    mockSelectFromWhereOrderBy([]);

    const { listPullRequestsByRepository } = await entities();
    const result = await listPullRequestsByRepository(999);
    expect(result).toEqual([]);
  });
});

describe('upsertPullRequest', () => {
  it('updates existing PR when found by repositoryId + externalId', async () => {
    const existing = { id: 10, repositoryId: 5, externalId: 42 };
    const updated = { id: 10, title: 'Updated title', status: 'merged' };

    // SELECT (lookup by repositoryId + externalId) — needs where().limit() chain
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([existing]),
        }),
      }),
    });
    // UPDATE
    mockUpdateSetWhereReturning([updated]);

    const { upsertPullRequest } = await entities();
    const result = await upsertPullRequest({
      repositoryId: 5,
      workspaceId: 1,
      externalId: 42,
      title: 'Updated title',
      description: 'Updated desc',
      author: 'dev1',
      sourceBranch: 'fix/auth',
      targetBranch: 'main',
      status: 'merged',
      prUrl: 'https://bitbucket.org/org/repo/pull-requests/42',
    });

    expect(result).toEqual(updated);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('creates new PR when no existing match is found', async () => {
    const created = { id: 20, title: 'Brand new PR' };

    // SELECT returns empty (no match) — needs where().limit() chain
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    // createPullRequest INSERT
    mockInsertReturning([created]);

    const { upsertPullRequest } = await entities();
    const result = await upsertPullRequest({
      repositoryId: 5,
      workspaceId: 1,
      externalId: 100,
      title: 'Brand new PR',
      author: 'dev2',
      sourceBranch: 'feature/new',
      targetBranch: 'main',
      status: 'open',
      prUrl: 'https://bitbucket.org/org/repo/pull-requests/100',
    });

    expect(result).toEqual(created);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

// ── Workspace Members ───────────────────────────────────────

describe('addWorkspaceMember', () => {
  it('inserts and returns workspace member', async () => {
    const mockRow = { id: 1, userId: 2, workspaceId: 3, role: 'member', createdAt: new Date() };
    mockInsertReturning([mockRow]);
    const { addWorkspaceMember } = await entities();
    const result = await addWorkspaceMember({ userId: 2, workspaceId: 3, role: 'member' });
    expect(result).toEqual(mockRow);
  });
});

describe('getWorkspaceMember', () => {
  it('returns membership when found', async () => {
    const mockRow = { id: 1, userId: 2, workspaceId: 3, role: 'workspace_admin' };
    mockSelectFromWhere([mockRow]);
    const { getWorkspaceMember } = await entities();
    const result = await getWorkspaceMember(2, 3);
    expect(result).toEqual(mockRow);
  });

  it('returns null when no membership', async () => {
    mockSelectFromWhere([]);
    const { getWorkspaceMember } = await entities();
    const result = await getWorkspaceMember(2, 99);
    expect(result).toBeNull();
  });
});

describe('removeWorkspaceMember', () => {
  it('deletes membership', async () => {
    mockDeleteWhere();
    const { removeWorkspaceMember } = await entities();
    await expect(removeWorkspaceMember(2, 3)).resolves.toBeUndefined();
  });
});

describe('updateMemberRole', () => {
  it('updates and returns member', async () => {
    const mockRow = { id: 1, userId: 2, workspaceId: 3, role: 'workspace_admin', createdAt: new Date() };
    mockUpdateSetWhereReturning([mockRow]);
    const { updateMemberRole } = await entities();
    const result = await updateMemberRole(2, 3, 'workspace_admin');
    expect(result).toEqual(mockRow);
  });

  it('returns null when member not found', async () => {
    mockUpdateSetWhereReturning([]);
    const { updateMemberRole } = await entities();
    const result = await updateMemberRole(99, 99, 'member');
    expect(result).toBeNull();
  });
});

describe('findUserById', () => {
  it('returns user when found', async () => {
    const mockUser = { id: 5, username: 'john', role: 'user' };
    mockSelectFromWhere([mockUser]);
    const { findUserById } = await entities();
    const result = await findUserById(5);
    expect(result).toEqual(mockUser);
  });

  it('returns null when not found', async () => {
    mockSelectFromWhere([]);
    const { findUserById } = await entities();
    const result = await findUserById(999);
    expect(result).toBeNull();
  });
});

describe('listAllUsers', () => {
  it('returns all users ordered by createdAt', async () => {
    const mockUsers = [{ id: 1, username: 'a' }, { id: 2, username: 'b' }];
    mockSelectFromOrderBy(mockUsers);
    const { listAllUsers } = await entities();
    const result = await listAllUsers();
    expect(result).toEqual(mockUsers);
  });
});

describe('deleteUser', () => {
  it('deletes user', async () => {
    mockDeleteWhere();
    const { deleteUser } = await entities();
    await expect(deleteUser(5)).resolves.toBeUndefined();
  });
});

describe('updateUser', () => {
  it('updates and returns user', async () => {
    const mockUser = { id: 5, username: 'john', displayName: 'John Doe', role: 'user' };
    mockUpdateSetWhereReturning([mockUser]);
    const { updateUser } = await entities();
    const result = await updateUser(5, { displayName: 'John Doe' });
    expect(result).toEqual(mockUser);
  });

  it('returns null when user not found', async () => {
    mockUpdateSetWhereReturning([]);
    const { updateUser } = await entities();
    const result = await updateUser(999, { displayName: 'Nobody' });
    expect(result).toBeNull();
  });
});

describe('countSuperAdmins', () => {
  it('returns count', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 2 }]),
      }),
    });
    const { countSuperAdmins } = await entities();
    const result = await countSuperAdmins();
    expect(result).toBe(2);
  });
});

describe('countWorkspaceAdmins', () => {
  it('returns count', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 3 }]),
      }),
    });
    const { countWorkspaceAdmins } = await entities();
    const result = await countWorkspaceAdmins(1);
    expect(result).toBe(3);
  });
});

// ── Workspace Tools ──────────────────────────────────────────────

describe('getWorkspaceTools', () => {
  it('returns tool selections for a workspace', async () => {
    const tools = [
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'trivy-secrets', enabled: false },
    ];
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(tools),
      }),
    });

    const { getWorkspaceTools } = await entities();
    const result = await getWorkspaceTools(1);
    expect(result).toEqual(tools);
    expect(mockDb.select).toHaveBeenCalled();
  });
});

describe('setWorkspaceTools', () => {
  it('upserts tool selections', async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const { setWorkspaceTools } = await entities();
    await setWorkspaceTools(1, [
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'trivy-secrets', enabled: false },
    ]);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('throws on invalid tool key', async () => {
    const { setWorkspaceTools } = await entities();
    await expect(setWorkspaceTools(1, [{ toolKey: 'invalid-tool', enabled: true }]))
      .rejects.toThrow('Invalid tool key');
  });
});

describe('initDefaultTools', () => {
  it('inserts recommended tools as enabled', async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const { initDefaultTools } = await entities();
    await initDefaultTools(1);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
