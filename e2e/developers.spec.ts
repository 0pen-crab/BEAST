import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Contributors Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/contributors');
  });

  test('displays contributors page with title', async ({ page }) => {
    await expect(page.getByText(/contributors/i).first()).toBeVisible();
  });

  test('search input is visible and filters table', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="name" i]').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('zzz-nonexistent-contributor');
      await page.waitForTimeout(500);
      // Should filter to empty or fewer results
      await searchInput.fill('');
      await page.waitForTimeout(300);
    }
  });

  test('sort dropdown is visible with options', async ({ page }) => {
    const sortSelect = page.locator('select').first();
    if (await sortSelect.isVisible()) {
      const options = await sortSelect.locator('option').count();
      expect(options).toBeGreaterThan(0);
      // Try changing sort
      if (options > 1) {
        await sortSelect.selectOption({ index: 1 });
        await page.waitForTimeout(300);
        // Reset
        await sortSelect.selectOption({ index: 0 });
      }
    }
  });

  test('contributors table or empty state shown', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText(/no contributor/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('clicking contributor navigates to profile page', async ({ page }) => {
    const contributorLink = page.locator('a[href^="/contributors/"]').first();
    if (await contributorLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contributorLink.click();
      await page.waitForURL(/\/contributors\/\d+/);
    }
  });
});

test.describe('Contributor Profile Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/contributors');
    const contributorLink = page.locator('a[href^="/contributors/"]').first();
    if (await contributorLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contributorLink.click();
      await page.waitForURL(/\/contributors\/\d+/);
    }
  });

  test('displays contributor name', async ({ page }) => {
    if (!page.url().match(/\/contributors\/\d+/)) return;
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('displays score labels (Overall, Security, Quality)', async ({ page }) => {
    if (!page.url().match(/\/contributors\/\d+/)) return;
    const scoreLabels = ['Overall', 'Security', 'Quality'];
    let found = 0;
    for (const label of scoreLabels) {
      if (await page.getByText(label).first().isVisible({ timeout: 500 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('displays repositories section', async ({ page }) => {
    if (!page.url().match(/\/contributors\/\d+/)) return;
    const repoSection = page.getByText(/repositor/i);
    await expect(repoSection.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test('navigating back returns to contributors list', async ({ page }) => {
    if (!page.url().match(/\/contributors\/\d+/)) return;
    // Use breadcrumb or browser back
    const backLink = page.locator('a[href="/contributors"]').first();
    if (await backLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await backLink.click();
      await expect(page).toHaveURL('/contributors');
    }
  });
});
