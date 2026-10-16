import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
const mockMigrate = vi.fn();
const mockEnd = vi.fn(async () => { calls.push('end'); });

// Tagged-template stand-in for a postgres-js client: records which advisory
// lock function each query called.
const mockSql = Object.assign(
  vi.fn(async (strings: TemplateStringsArray) => {
    calls.push(strings.join('?').match(/pg_advisory_\w+/)![0]);
    return [];
  }),
  { end: mockEnd },
);

vi.mock('postgres', () => ({ default: vi.fn(() => mockSql) }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn(() => ({})) }));
vi.mock('drizzle-orm/postgres-js/migrator', () => ({ migrate: mockMigrate }));

const { runMigrations } = await import('./migrate.ts');

// api and worker both migrate on boot. Unless they serialize on one lock,
// both apply every pending migration.
describe('runMigrations', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    mockMigrate.mockImplementation(async () => { calls.push('migrate'); });
  });

  it('migrates while holding the advisory lock', async () => {
    await runMigrations('postgres://db');
    expect(calls).toEqual(['pg_advisory_lock', 'migrate', 'pg_advisory_unlock', 'end']);
  });

  it('releases the lock and the connection when a migration fails', async () => {
    mockMigrate.mockImplementation(async () => { calls.push('migrate'); throw new Error('bad sql'); });
    await expect(runMigrations('postgres://db')).rejects.toThrow('bad sql');
    expect(calls).toEqual(['pg_advisory_lock', 'migrate', 'pg_advisory_unlock', 'end']);
  });

  it('treats "relation already exists" on a pre-drizzle database as done', async () => {
    mockMigrate.mockRejectedValue({ cause: { code: '42P07' } });
    await expect(runMigrations('postgres://db')).resolves.toBeUndefined();
  });
});
