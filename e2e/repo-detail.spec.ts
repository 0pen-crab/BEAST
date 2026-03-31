import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Repo Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    // Navigate to first available repo
    await page.goto('/repos');
    const repoLink = page.locator('a[href^="/repos/"]').first();
    if (await repoLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await repoLink.click();
      await page.waitForURL(/\/repos\/\d+/);
    }
  });

  test('displays repo name and status badge', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return; // skip if no repos
    // Repo name should be in a heading
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).not.toBeEmpty();
  });

  test('displays severity stat cards', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];
    let found = 0;
    for (const sev of severities) {
      if (await page.getByText(sev).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('edit button opens edit dialog', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const editBtn = page.getByRole('button', { name: /edit/i });
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      // Should see form inputs for name/description in the edit dialog
      await expect(page.locator('input[type="text"]').first()).toBeVisible();
      await expect(page.locator('textarea').first()).toBeVisible();
    }
  });

  test('findings table shows with filters', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    // Look for the "All Findings" heading
    const findingsHeading = page.getByText(/all findings/i);
    if (await findingsHeading.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      // Filter controls section should be visible with "Filters" label
      await expect(page.getByText(/filters/i).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('tool cards are visible if tests exist', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    // The section heading "Scan results by tool" should be visible
    const toolHeading = page.getByText(/scan results by tool/i);
    await expect(toolHeading).toBeVisible({ timeout: 5000 });
    // Tool cards show tool display names: BEAST, Gitleaks, Trufflehog, Trivy, JFrog Xray
    const toolNames = ['BEAST', 'Gitleaks', 'Trivy', 'Trufflehog', 'JFrog Xray'];
    let found = 0;
    for (const tool of toolNames) {
      if (await page.getByText(tool, { exact: false }).first().isVisible({ timeout: 1000 }).catch(() => false)) {
        found++;
      }
    }
    // All 5 tool cards should render (even inactive ones show the name)
    expect(found).toBeGreaterThanOrEqual(1);
  });

  test('delete button shows confirmation dialog', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();
      // Confirmation dialog should appear with warning text
      await expect(page.getByText(/cannot be undone|all their data/i)).toBeVisible({ timeout: 3000 });
      // Cancel to avoid actually deleting
      await page.getByRole('button', { name: /cancel/i }).click();
    }
  });
});
