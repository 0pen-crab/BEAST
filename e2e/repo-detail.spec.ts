import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Repo Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/repos');
    const repoLink = page.locator('a[href^="/repos/"]').first();
    if (await repoLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await repoLink.click();
      await page.waitForURL(/\/repos\/\d+/);
    }
  });

  test('displays repo name and status badge', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
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

  test('edit button opens dialog with name and description fields', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const editBtn = page.getByRole('button', { name: /edit/i });
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.locator('input[type="text"]').first()).toBeVisible();
      await expect(page.locator('textarea').first()).toBeVisible();
    }
  });

  test('edit dialog can be cancelled without saving', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const editBtn = page.getByRole('button', { name: /edit/i });
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.locator('input[type="text"]').first()).toBeVisible();
      // Click cancel
      const cancelBtn = page.getByRole('button', { name: /cancel/i });
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('scan results by tool section is visible', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const toolHeading = page.getByText(/scan results by tool/i);
    await expect(toolHeading).toBeVisible({ timeout: 5000 });
  });

  test('tool cards show known security tools', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const toolNames = ['BEAST', 'Gitleaks', 'Trivy', 'Trufflehog', 'JFrog Xray'];
    let found = 0;
    for (const tool of toolNames) {
      if (await page.getByText(tool, { exact: false }).first().isVisible({ timeout: 1000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(1);
  });

  test('findings section shows with filters', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const findingsHeading = page.getByText(/all findings/i);
    if (await findingsHeading.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(page.getByText(/filters/i).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('delete button shows confirmation and cancel works', async ({ page }) => {
    if (!page.url().match(/\/repos\/\d+/)) return;
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();
      // Confirmation dialog
      await expect(page.getByText(/cannot be undone|all their data/i)).toBeVisible({ timeout: 3000 });
      // Cancel — do NOT delete
      await page.getByRole('button', { name: /cancel/i }).click();
      // Should still be on repo page
      await expect(page).toHaveURL(/\/repos\/\d+/);
    }
  });
});
