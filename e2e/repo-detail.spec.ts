import { test, expect } from '@playwright/test';
import { ensureLoggedIn, skipIfEmpty } from './helpers';

test.describe('Repo Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    // Open the repo with the most findings, so the findings checks have data to look at.
    await page.goto('/repos?sort=findingsCount&dir=desc');
    const repoLink = page.locator('a[href^="/repos/"]').first();
    await skipIfEmpty(page, repoLink, 'repositories');
    await repoLink.click();
    await page.waitForURL(/\/repos\/\d+/);
  });

  test('displays repo name', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).not.toBeEmpty();
  });

  test('scan results by tool section is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /scan results by tool/i })).toBeVisible();
  });

  test('tool section shows known security tools or says there is no scan data', async ({ page }) => {
    const tool = page.getByText(/BEAST|Gitleaks|Trivy|TruffleHog|JFrog Xray/).first();
    const noScan = page.getByText('No scan data');
    await expect(tool.or(noScan)).toBeVisible();
  });

  test('top findings lists findings with their severity', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /top findings/i })).toBeVisible();
    await skipIfEmpty(page, page.locator('tbody tr'), 'findings for this repository');
    await expect(page.locator('tbody').getByText(/^(Critical|High|Medium|Low|Info)$/).first()).toBeVisible();
  });

  test('delete button shows confirmation and cancel works', async ({ page }) => {
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    // Cancel — do NOT delete
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText(/cannot be undone/i)).toHaveCount(0);
    await expect(page).toHaveURL(/\/repos\/\d+/);
  });
});
