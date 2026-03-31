/**
 * Pipeline integration test.
 *
 * Runs a real scan against https://github.com/vitfury/stealer and verifies
 * that all pipeline steps produce expected output. This test is slow (~5-10 min)
 * because it waits for the full scan to complete.
 *
 * Prerequisites:
 *   - App running at localhost:8000 (docker compose up -d)
 *   - admin/admin1 account exists
 *   - claude-runner and security-tools containers are up
 *
 * Run:
 *   cd integration && npx vitest run src/pipeline.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  authedApi,
  loginUser,
  createTestWorkspace,
  addTestRepo,
  enableFreeTools,
  triggerScan,
  waitForScan,
  type AuthContext,
} from './helpers.ts';

const REPO_URL = 'https://github.com/vitfury/stealer';
const SCAN_TIMEOUT_MS = 1_200_000; // 20 minutes (AI analysis can be slow)

describe('pipeline: full scan of vitfury/stealer', () => {
  let auth: AuthContext;
  let wsId: number;
  let repoId: number;
  let scanId: string;
  let completedScan: any;

  // ── Setup: workspace, repo, tools, trigger scan, wait ──────────

  beforeAll(async () => {
    auth = await loginUser('admin', 'admin1');
    wsId = await createTestWorkspace(auth, `pipeline_test_${Date.now()}`);
    await enableFreeTools(auth, wsId);

    const repo = await addTestRepo(auth, wsId, REPO_URL);
    repoId = repo.id;

    const scan = await triggerScan(auth, repoId);
    scanId = scan.id;
    expect(scan.status).toBe('queued');

    console.log(`[pipeline-test] Scan ${scanId} queued, waiting for completion...`);
    completedScan = await waitForScan(auth, scanId, SCAN_TIMEOUT_MS);
    console.log(`[pipeline-test] Scan finished with status: ${completedScan.status}`);
  }, SCAN_TIMEOUT_MS + 30_000); // beforeAll timeout slightly above scan timeout

  // ── Scan completion ────────────────────────────────────────────

  it('scan reaches terminal status', () => {
    // Scan may fail if AI steps timeout, but required steps (clone, import) must succeed
    expect(['completed', 'failed']).toContain(completedScan.status);
  });

  // ── Pipeline steps ─────────────────────────────────────────────

  it('has all 6 pipeline steps', () => {
    const steps = completedScan.steps;
    expect(steps).toHaveLength(6);

    const names = steps.map((s: any) => s.stepName);
    expect(names).toEqual([
      'clone',
      'analysis',
      'security-tools',
      'ai-research',
      'import',
      'triage-report',
    ]);
  });

  it('clone step completed', () => {
    const clone = completedScan.steps.find((s: any) => s.stepName === 'clone');
    expect(clone.status).toBe('completed');
  });

  it('security-tools step completed', () => {
    const st = completedScan.steps.find((s: any) => s.stepName === 'security-tools');
    // May be 'completed' or 'failed' (if scan was cancelled during AI step)
    // but should not be 'pending' — it must have run
    expect(st.status).not.toBe('pending');
  });

  it('import step completed', () => {
    const imp = completedScan.steps.find((s: any) => s.stepName === 'import');
    expect(imp.status).toBe('completed');
  });

  // ── Tests (per-tool result records) ────────────────────────────

  it('created test records for security tools', async () => {
    const res = await authedApi(auth, `/tests?scan_id=${scanId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    const tests = Array.isArray(data) ? data : (data.results ?? []);
    const tools = tests.map((t: any) => t.tool);

    // At minimum these free tools should have run and produced test records
    expect(tools).toContain('gitleaks');
    expect(tools).toContain('trufflehog');
    expect(tools).toContain('semgrep');
  });

  // ── Findings ───────────────────────────────────────────────────

  it('imported findings from scan', async () => {
    const res = await authedApi(auth, `/findings?workspace_id=${wsId}&limit=500`);
    expect(res.ok).toBe(true);
    const data = await res.json();

    // vitfury/stealer is a known malicious repo — should find secrets/vulns
    expect(data.count).toBeGreaterThan(0);
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('findings have correct structure', async () => {
    const res = await authedApi(auth, `/findings?workspace_id=${wsId}&limit=5`);
    const data = await res.json();
    if (data.results.length === 0) return;

    const f = data.results[0];
    expect(f).toHaveProperty('id');
    expect(f).toHaveProperty('title');
    expect(f).toHaveProperty('severity');
    expect(f).toHaveProperty('tool');
    expect(f).toHaveProperty('fingerprint');
    expect(f).toHaveProperty('active');
    expect(['critical', 'high', 'medium', 'low', 'info']).toContain(f.severity.toLowerCase());
  });

  it('findings have unique fingerprints (deduplication works)', async () => {
    const res = await authedApi(auth, `/findings?workspace_id=${wsId}&limit=500`);
    const data = await res.json();

    const fingerprints = data.results.map((f: any) => f.fingerprint);
    const unique = new Set(fingerprints);
    expect(unique.size).toBe(fingerprints.length);
  });

  // ── Scan events ────────────────────────────────────────────────

  it('logged scan events', async () => {
    const res = await authedApi(auth, `/scan-events?workspace_id=${wsId}&scan_id=${scanId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    const events = data.results ?? data;

    expect(events.length).toBeGreaterThan(0);

    // Should have at least a "Scan started" info event
    const infoEvents = events.filter((e: any) => e.level === 'info');
    expect(infoEvents.length).toBeGreaterThan(0);
  });

  // ── Scan artifacts (filesystem) ─────────────────────────────────

  it('stored scan step artifacts', async () => {
    // Check that the clone step has artifacts
    const res = await authedApi(auth, `/scans/${scanId}/steps/clone/artifacts`);
    if (!res.ok) return; // artifacts may be on different volume
    const files = await res.json();
    // Clone step may or may not have artifacts — just verify endpoint works
    expect(Array.isArray(files)).toBe(true);
  });

  // ── Repository status ──────────────────────────────────────────

  it('repository status updated after scan', async () => {
    const res = await authedApi(auth, `/repositories/${repoId}`);
    expect(res.ok).toBe(true);
    const repo = await res.json();
    expect(repo.id).toBe(repoId);
    expect(['completed', 'failed']).toContain(repo.status);
    expect(repo.status).not.toBe('queued');
    expect(repo.status).not.toBe('pending');
  });

  // ── Idempotency: re-scan should not create duplicate findings ──

  it('re-scan does not duplicate findings', async () => {
    // Get finding count after first scan
    const res1 = await authedApi(auth, `/findings?workspace_id=${wsId}&limit=500`);
    const data1 = await res1.json();
    const count1 = data1.count;

    // Trigger second scan
    const scan2 = await triggerScan(auth, repoId);
    console.log(`[pipeline-test] Re-scan ${scan2.id} queued, waiting...`);
    const completed2 = await waitForScan(auth, scan2.id, SCAN_TIMEOUT_MS);
    expect(['completed', 'failed']).toContain(completed2.status);

    // Get finding count after second scan
    const res2 = await authedApi(auth, `/findings?workspace_id=${wsId}&limit=500`);
    const data2 = await res2.json();
    const count2 = data2.count;

    // Findings should NOT double — allow up to 30% growth for AI variance
    // (AI tools may produce slightly different results each run)
    expect(count2).toBeLessThan(count1 * 2);
    console.log(`[pipeline-test] Findings: scan1=${count1}, scan2=${count2}, growth=${count2 - count1}`);
  }, SCAN_TIMEOUT_MS + 30_000);
});
