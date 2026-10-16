// Tests for the shell scripts and compose wiring that security-tools.ts drives
// over SSH. They live here because this is where vitest runs and because
// security-tools.ts is the caller of run-scans.sh — a regression in the script
// contract breaks this step, not the container.
//
// Background: a scan blocked for 23 minutes because trivy decided to refresh its
// 1.4 GB vulnerability DB mid-scan, and the cache lived in the container's
// writable layer so every `docker compose build security-tools` wiped it. These
// tests pin the fix: the DB download happens out of band, scans never update it,
// and the cache survives a rebuild.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const SCRIPTS_DIR = join(REPO_ROOT, 'security-tools/scripts');
const TRIVY_DB_SH = join(SCRIPTS_DIR, 'trivy-db.sh');
const RUN_SCANS_SH = join(SCRIPTS_DIR, 'run-scans.sh');
const COMPOSE_FILE = join(REPO_ROOT, 'docker-compose.yml');

/** Cache layout trivy-db.sh inspects. */
const CACHE_PATHS = {
  db: 'db/trivy.db',
  meta: 'db/metadata.json',
  javaDb: 'java-db/trivy-java.db',
  javaMeta: 'java-db/metadata.json',
};

/** Markers the stubbed trivy writes, so a swap is visible in the file content. */
const FRESH = {
  db: 'FRESH-DB',
  dbMeta: '{"Version":2,"fresh":true}',
  javaDb: 'FRESH-JAVA-DB',
  javaMeta: '{"Version":1,"fresh":true}',
};

describe('trivy-db.sh', () => {
  let tmp: string;
  let cacheDir: string;
  let binDir: string;
  let callLog: string;

  /**
   * Installs a fake `trivy` on PATH that records its argv.
   *
   * `failOn` simulates a download failure for just the invocations whose args
   * contain that string, so a test can fail the Java DB while the vulnerability
   * DB succeeds — the two are deliberately not equally fatal.
   */
  function stubTrivy(failOn?: string): void {
    const stub = join(binDir, 'trivy');
    const failCheck = failOn
      ? `if [[ "$*" == *${JSON.stringify(failOn)}* ]]; then exit 1; fi\n`
      : '';
    // Writes into whatever --cache-dir it is handed, exactly as trivy does, so a
    // test can tell a download apart from the swap that follows it.
    writeFileSync(
      stub,
      `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(callLog)}
${failCheck}target=""; prev=""
for a in "$@"; do [[ "$prev" == "--cache-dir" ]] && target="$a"; prev="$a"; done
if [[ "$*" == *--download-db-only* ]]; then
  mkdir -p "$target/db"
  echo '${FRESH.db}' > "$target/db/trivy.db"
  echo '${FRESH.dbMeta}' > "$target/db/metadata.json"
else
  mkdir -p "$target/java-db"
  echo '${FRESH.javaDb}' > "$target/java-db/trivy-java.db"
  echo '${FRESH.javaMeta}' > "$target/java-db/metadata.json"
fi
exit 0
`,
    );
    chmodSync(stub, 0o755);
  }

  function readCache(relPath: string): string {
    return readFileSync(join(cacheDir, relPath), 'utf8').trim();
  }

  function writeCacheFile(relPath: string, content = 'x'): void {
    const full = join(cacheDir, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }

  // spawnSync, not execFileSync: the latter only hands back stderr by throwing,
  // so a script that warns on stderr and still exits 0 would look silent.
  function run(mode: string): { status: number; stdout: string; stderr: string } {
    const r = spawnSync('bash', [TRIVY_DB_SH, mode], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        TRIVY_CACHE_DIR: cacheDir,
        // These tests are about download and swap logic, not capacity, and the
        // tmpdir they run in may well have less free space than a real cache
        // volume. The capacity guard has its own test.
        TRIVY_DB_MIN_FREE_MB: '1',
      },
      encoding: 'utf8',
    });
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  function trivyCalls(): string[] {
    try {
      return readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'beast-trivydb-'));
    cacheDir = join(tmp, 'cache');
    binDir = join(tmp, 'bin');
    callLog = join(tmp, 'trivy-calls.log');
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    stubTrivy();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('ensure', () => {
    // A fresh security-tools volume has /home/scanner/.cache but no trivy/
    // inside it. df on the missing path failed, the free-space number came out
    // empty and every first scan on a new install died with "only  MB free".
    it('creates a missing cache directory and downloads into it', () => {
      rmSync(cacheDir, { recursive: true, force: true });

      const { status, stderr } = run('ensure');

      expect(stderr).not.toMatch(/MB free/);
      expect(status).toBe(0);
      expect(readCache(CACHE_PATHS.db)).toBe(FRESH.db);
    });

    it('says it could not read the free space instead of reporting an empty number', () => {
      writeFileSync(join(binDir, 'df'), '#!/bin/bash\necho "df: broken" >&2\nexit 1\n');
      chmodSync(join(binDir, 'df'), 0o755);

      const { status, stderr } = run('ensure');

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/could not read free space/);
      expect(stderr).not.toMatch(/only\s+MB/);
    });

    it('downloads both databases when the cache is empty', () => {
      const { status } = run('ensure');

      expect(status).toBe(0);
      const calls = trivyCalls();
      expect(calls.some((c) => c.includes('--download-db-only'))).toBe(true);
      expect(calls.some((c) => c.includes('--download-java-db-only'))).toBe(true);
    });

    it('downloads nothing when both databases are already present', () => {
      writeCacheFile(CACHE_PATHS.db);
      writeCacheFile(CACHE_PATHS.meta);
      writeCacheFile(CACHE_PATHS.javaDb);
      writeCacheFile(CACHE_PATHS.javaMeta);

      const { status } = run('ensure');

      expect(status).toBe(0);
      expect(trivyCalls()).toEqual([]);
    });

    it('keeps a stale database rather than refreshing it mid-scan', () => {
      // A year-old NextUpdate is exactly the condition that cost 23 minutes.
      // `ensure` must not care: staleness is the nightly job's problem.
      writeCacheFile(CACHE_PATHS.db);
      writeCacheFile(CACHE_PATHS.meta, JSON.stringify({ NextUpdate: '2020-01-01T00:00:00Z' }));
      writeCacheFile(CACHE_PATHS.javaDb);
      writeCacheFile(CACHE_PATHS.javaMeta);

      const { status } = run('ensure');

      expect(status).toBe(0);
      expect(trivyCalls()).toEqual([]);
    });

    it('downloads only the Java database when the vulnerability database is present', () => {
      writeCacheFile(CACHE_PATHS.db);
      writeCacheFile(CACHE_PATHS.meta);

      const { status } = run('ensure');

      expect(status).toBe(0);
      const calls = trivyCalls();
      expect(calls.some((c) => c.includes('--download-java-db-only'))).toBe(true);
      expect(calls.some((c) => c.includes('--download-db-only'))).toBe(false);
    });

    it('re-downloads when the database file is present but empty', () => {
      // A half-written cache (killed container, full disk) leaves a 0-byte
      // trivy.db. Trivy then dies with --skip-db-update, so treat it as absent.
      writeCacheFile(CACHE_PATHS.db, '');
      writeCacheFile(CACHE_PATHS.meta);
      writeCacheFile(CACHE_PATHS.javaDb);
      writeCacheFile(CACHE_PATHS.javaMeta);

      const { status } = run('ensure');

      expect(status).toBe(0);
      expect(trivyCalls().some((c) => c.includes('--download-db-only'))).toBe(true);
    });

    it('fails loudly when the vulnerability DB download fails', () => {
      // No vuln DB means trivy cannot scan for vulnerabilities at all, and a
      // scan that reports a clean repo because its database is missing is worse
      // than a scan that does not run.
      stubTrivy('--download-db-only');

      const { status, stderr } = run('ensure');

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/ERROR/);
    });

    it('warns but continues when only the Java index DB download fails', () => {
      // run-scans.sh runs under `set -e`, so a non-zero exit here aborts the
      // whole tool run. The Java index DB only affects Java dependency
      // resolution — losing it must not take the other nine tools down with it.
      // A scan that actually needs it fails on that trivy run, which surfaces
      // as a normal tool failure.
      writeCacheFile(CACHE_PATHS.db);
      writeCacheFile(CACHE_PATHS.meta);
      stubTrivy('--download-java-db-only');

      const { status, stderr } = run('ensure');

      expect(status).toBe(0);
      expect(stderr).toMatch(/WARNING/);
    });
  });

  describe('update', () => {
    /** Pre-existing, about-to-be-replaced databases. */
    function seedOldDatabases(): void {
      writeCacheFile(CACHE_PATHS.db, 'STALE-DB');
      writeCacheFile(CACHE_PATHS.meta, '{"Version":2,"fresh":false}');
      writeCacheFile(CACHE_PATHS.javaDb, 'STALE-JAVA-DB');
      writeCacheFile(CACHE_PATHS.javaMeta, '{"Version":1,"fresh":false}');
    }

    it('replaces the live databases with the freshly downloaded ones', () => {
      seedOldDatabases();

      const { status } = run('update');

      expect(status).toBe(0);
      expect(readCache(CACHE_PATHS.db)).toBe(FRESH.db);
      expect(readCache(CACHE_PATHS.meta)).toBe(FRESH.dbMeta);
      expect(readCache(CACHE_PATHS.javaDb)).toBe(FRESH.javaDb);
      expect(readCache(CACHE_PATHS.javaMeta)).toBe(FRESH.javaMeta);
    });

    it('downloads into the cache filesystem, never /tmp', () => {
      // mv is only atomic within one filesystem. In the container /tmp is the
      // overlay and the cache is a volume, so staging in /tmp would silently
      // downgrade the swap to copy-then-delete and reopen the torn-file window
      // this whole design exists to close.
      run('update');

      const cacheDirArgs = trivyCalls()
        .map((c) => c.match(/--cache-dir (\S+)/)?.[1])
        .filter((v): v is string => Boolean(v));

      expect(cacheDirArgs.length).toBeGreaterThan(0);
      for (const dir of cacheDirArgs) expect(dir.startsWith(cacheDir)).toBe(true);
    });

    it('leaves the live database untouched when the download fails', () => {
      // A failed refresh must never cost us the working database we already had.
      seedOldDatabases();
      stubTrivy('--download-db-only');

      const { status } = run('update');

      expect(status).not.toBe(0);
      expect(readCache(CACHE_PATHS.db)).toBe('STALE-DB');
      expect(readCache(CACHE_PATHS.meta)).toBe('{"Version":2,"fresh":false}');
    });

    it('still refreshes the Java DB after the vulnerability DB fails', () => {
      // One failing download must not skip the other, or a transient error on
      // the big DB would leave the Java DB stale indefinitely.
      seedOldDatabases();
      stubTrivy('--download-db-only');

      run('update');

      expect(readCache(CACHE_PATHS.javaDb)).toBe(FRESH.javaDb);
    });

    it.each(['--download-db-only', '--download-java-db-only'])(
      'fails loudly when %s fails — a silent nightly is how a cache goes cold',
      (flag) => {
        stubTrivy(flag);

        const { status, stderr } = run('update');

        expect(status).not.toBe(0);
        expect(stderr).toMatch(/ERROR/);
      },
    );

    it('leaves no staging directory behind', () => {
      run('update');

      const leftovers = readdirSync(cacheDir).filter((e) => e.includes('staging'));
      expect(leftovers).toEqual([]);
    });

    it('refuses to start when the disk cannot hold the download', () => {
      // We already lost a 2-hour download to ENOSPC at 100% progress. Check
      // first, fail in a second, and keep the existing database.
      seedOldDatabases();

      const r = spawnSync('bash', [TRIVY_DB_SH, 'update'], {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          TRIVY_CACHE_DIR: cacheDir,
          TRIVY_DB_MIN_FREE_MB: '999999999',
        },
        encoding: 'utf8',
      });

      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/ERROR/);
      expect(trivyCalls()).toEqual([]);
      expect(readCache(CACHE_PATHS.db)).toBe('STALE-DB');
    });
  });

  it('rejects an unknown mode', () => {
    const { status, stderr } = run('refresh-please');

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/ensure\|update/);
  });

  it('passes the cache directory explicitly so cron and sshd agree on it', () => {
    // cron runs without the login environment; an implicit ~/.cache would put
    // the nightly download somewhere the scan never looks.
    run('update');

    for (const call of trivyCalls()) {
      expect(call).toContain(`--cache-dir ${cacheDir}`);
    }
  });
});

describe('run-scans.sh trivy contract', () => {
  const script = readFileSync(RUN_SCANS_SH, 'utf8');

  /** Each `trivy fs ...` invocation, flattened to one line. */
  function trivyInvocations(): string[] {
    return script
      .replace(/\\\n\s*/g, ' ') // join backslash continuations
      .split('\n')
      .filter((line) => /\btrivy fs\b/.test(line));
  }

  it('has the trivy scans this suite is pinning', () => {
    expect(trivyInvocations().length).toBeGreaterThanOrEqual(3);
  });

  it.each(['--skip-db-update', '--skip-java-db-update', '--skip-check-update'])(
    'passes %s to every trivy scan',
    (flag) => {
      for (const invocation of trivyInvocations()) {
        expect(invocation).toContain(flag);
      }
    },
  );

  it('ensures the databases exist before any tool runs', () => {
    expect(script).toMatch(/trivy-db\.sh\s+ensure/);

    const ensureAt = script.search(/trivy-db\.sh\s+ensure/);
    const firstTrivyAt = script.search(/\btrivy fs\b/);
    expect(ensureAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeLessThan(firstTrivyAt);
  });
});

describe('run-scans.sh trufflehog contract', () => {
  const script = readFileSync(RUN_SCANS_SH, 'utf8').replace(/\\\n\s*/g, ' ');

  // Filesystem mode only sees the working tree, so a secret "removed" in a
  // later commit stays in history and goes unreported. gitleaks already scans
  // history; trufflehog must too.
  it('scans git history when the repo has .git', () => {
    expect(script).toMatch(/trufflehog git\s+"?file:\/\/\$REPO_PATH"?/);
  });

  it('falls back to a filesystem scan for repos without .git', () => {
    expect(script).toMatch(/trufflehog filesystem\s+--directory="\$REPO_PATH"/);
    const block = script.slice(script.search(/run_tool_trufflehog\(\)/), script.search(/run_tool "trufflehog"/));
    expect(block).toMatch(/-d "\$REPO_PATH\/\.git"/);
  });
});

interface ComposeFile {
  services: Record<string, { volumes: string[] }>;
  volumes: Record<string, unknown>;
}

describe('security-tools cache volume', () => {
  const compose = yaml.load(readFileSync(COMPOSE_FILE, 'utf8')) as ComposeFile;
  const service = compose.services['security-tools'];

  it('mounts the tool cache on a named volume so a rebuild cannot wipe it', () => {
    const mount = service.volumes.find((v) => v.includes('/home/scanner/.cache'));

    expect(mount).toBeDefined();
    const [source] = mount!.split(':');
    // A bind mount (./x or /x) would tie the cache to the host layout; a named
    // volume is what survives `docker compose build && up -d`.
    expect(source.startsWith('.') || source.startsWith('/')).toBe(false);
    expect(compose.volumes).toHaveProperty(source);
  });
});
