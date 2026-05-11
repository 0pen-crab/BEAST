import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/');
  });

  test('displays page title', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
  });

  test('severity distribution section is visible', async ({ page }) => {
    await expect(page.getByText(/severity distribution/i)).toBeVisible();
  });

  test('tools section shows tool categories', async ({ page }) => {
    await expect(page.getByText(/tools/i).first()).toBeVisible();
    // Tool categories: Code Analysis, Dependencies, Infrastructure, Secrets, Personal Data
    const categories = ['Code Analysis', 'Dependencies', 'Secrets'];
    let found = 0;
    for (const cat of categories) {
      if (await page.getByText(cat).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('recent scans section is visible', async ({ page }) => {
    await expect(page.getByText(/recent scans/i)).toBeVisible();
  });

  test('recent scans link navigates to scans page', async ({ page }) => {
    const viewAll = page.locator('a[href="/scans"]').first();
    if (await viewAll.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewAll.click();
      await expect(page).toHaveURL('/scans');
    }
  });

  test('repositories section is visible', async ({ page }) => {
    await expect(page.getByText(/repositories/i).first()).toBeVisible();
  });

  test('repo link navigates to repo detail page', async ({ page }) => {
    const repoLink = page.locator('a[href^="/repos/"]').first();
    if (await repoLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      const href = await repoLink.getAttribute('href');
      await repoLink.click();
      await expect(page).toHaveURL(href!);
    }
  });
});
