import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/');
  });

  test('displays severity stat cards', async ({ page }) => {
    // Should have stat cards for severities
    const severities = ['Critical', 'High', 'Medium'];
    for (const sev of severities) {
      await expect(page.getByText(sev).first()).toBeVisible();
    }
  });

  test('displays total active findings count', async ({ page }) => {
    await expect(page.getByText(/total active/i)).toBeVisible();
  });

  test('displays recent scans section', async ({ page }) => {
    await expect(page.getByText(/recent scans/i)).toBeVisible();
  });

  test('displays repositories section', async ({ page }) => {
    await expect(page.getByText(/repositories/i).first()).toBeVisible();
  });

  test('displays security tools section', async ({ page }) => {
    await expect(page.getByText(/security tools/i)).toBeVisible();
  });

  test('repo links navigate to repo detail', async ({ page }) => {
    const repoLink = page.locator('a[href^="/repos/"]').first();
    if (await repoLink.isVisible()) {
      const href = await repoLink.getAttribute('href');
      await repoLink.click();
      await expect(page).toHaveURL(href!);
    }
  });
});
