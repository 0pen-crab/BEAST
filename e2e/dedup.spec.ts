import { test, expect, type Page } from '@playwright/test';
import { ensureLoggedIn, getAuthToken } from './helpers';

/**
 * Cross-tool dedup E2E
 *
 * Verifies that when multiple security tools detect the same finding (same file
 * + line ±1, same secret_value or same vulnerability type), the AI triage links
 * them via duplicate_of FK and the UI surfaces:
 *   1. "+N" badge on the survivor in the findings list
 *   2. "Also detected by (N)" section with clickable rows on the survivor's detail
 *   3. "Duplicate of #X" banner on the duplicate's detail
 *
 * Pre-requisite: a completed scan must exist with cross-tool duplicates. The
 * shared simple-worker-api repo (id=139) is re-scanned by an out-of-band run
 * before CI; this spec only verifies the UI.
 */

const REPO_ID = 139; // simple-worker-api

async function findRepoSurvivor(page: Page) {
  const token = await getAuthToken(page);
  // Resolve workspace from repo. The repo is seeded by an out-of-band scan
  // run — on a fresh DB it does not exist and every test here must skip
  // (same treatment as "no cross-tool duplicates"), not fail.
  const repoRes = await page.request.get(`/api/repositories/${REPO_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!repoRes.ok()) return undefined;
  const repo = await repoRes.json();
  const wsId = repo.workspaceId;

  const res = await page.request.get(
    `/api/findings?repository_id=${REPO_ID}&workspace_id=${wsId}&page_size=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return (body.results as Array<{ id: number; duplicateCount?: number; title: string; tool: string }>)
    .find((f) => (f.duplicateCount ?? 0) > 0);
}

async function switchToRepoWorkspace(page: Page) {
  const token = await getAuthToken(page);
  const repoRes = await page.request.get(`/api/repositories/${REPO_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!repoRes.ok()) return; // repo not seeded — tests will skip via findRepoSurvivor
  const repo = await repoRes.json();
  // Match the WorkspaceProvider key (workspace.tsx WS_KEY)
  await page.evaluate((wsId) => localStorage.setItem('beast_workspace_id', String(wsId)), repo.workspaceId);
}

test.describe('Cross-tool dedup', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await switchToRepoWorkspace(page);
  });

  test('findings list shows +N cross-tool badge on survivors', async ({ page }) => {
    const survivor = await findRepoSurvivor(page);
    test.skip(!survivor, 'No cross-tool duplicates in repo — re-run scan with new triage');

    await page.goto(`/findings?repository=${REPO_ID}`);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('span.beast-badge-cross-tool').first();
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toHaveText(/^\+\d+$/);
  });

  test('survivor detail shows "Also detected by" section with clickable rows', async ({ page }) => {
    const survivor = await findRepoSurvivor(page);
    test.skip(!survivor, 'No cross-tool duplicates in repo — re-run scan with new triage');

    await page.goto(`/findings/${survivor!.id}`);
    await page.waitForLoadState('networkidle');

    // Section header: "Also detected by (N)" or Ukrainian translation
    const heading = page.getByText(/Also detected by|Також знайдено/i).first();
    await expect(heading).toBeVisible({ timeout: 5000 });

    // At least one duplicate row, clickable to a finding URL
    const dupLink = page.locator('a[href^="/findings/"]').filter({
      has: page.locator('img.beast-tool-row-icon'),
    }).first();
    await expect(dupLink).toBeVisible();
    const href = await dupLink.getAttribute('href');
    expect(href).toMatch(/^\/findings\/\d+$/);
  });

  test('duplicate detail shows "Duplicate of #X" banner with survivor link', async ({ page }) => {
    const survivor = await findRepoSurvivor(page);
    test.skip(!survivor, 'No cross-tool duplicates in repo — re-run scan with new triage');

    // Navigate to survivor, grab the first duplicate's URL
    await page.goto(`/findings/${survivor!.id}`);
    await page.waitForLoadState('networkidle');
    const dupLink = page.locator('a[href^="/findings/"]').filter({
      has: page.locator('img.beast-tool-row-icon'),
    }).first();
    const dupHref = await dupLink.getAttribute('href');
    expect(dupHref).toBeTruthy();

    await page.goto(dupHref!);
    await page.waitForLoadState('networkidle');

    // Banner with "Duplicate of" label and link back to survivor
    const banner = page.locator('.beast-duplicate-banner');
    await expect(banner).toBeVisible({ timeout: 5000 });

    const survivorLink = banner.locator('a').first();
    const survivorHref = await survivorLink.getAttribute('href');
    expect(survivorHref).toBe(`/findings/${survivor!.id}`);
  });
});
