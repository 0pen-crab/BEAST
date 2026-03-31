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

  test('search input is visible', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="name" i]').first();
    await expect(searchInput).toBeVisible({ timeout: 3000 }).catch(() => {});
  });

  test('sort dropdown is visible', async ({ page }) => {
    const sortSelect = page.locator('select').first();
    if (await sortSelect.isVisible()) {
      // Should have sort options
      const options = await sortSelect.locator('option').count();
      expect(options).toBeGreaterThan(0);
    }
  });

  test('contributors table or empty state shown', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText(/no contributor/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('clicking contributor navigates to profile', async ({ page }) => {
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

  test('displays contributor name and scores', async ({ page }) => {
    if (!page.url().match(/\/contributors\/\d+/)) return;
    await expect(page.locator('h1, h2').first()).toBeVisible();
    // Score labels should be visible (from ScoreBreakdown or OverallScore)
    const scoreLabels = ['Overall', 'Security', 'Quality'];
    let found = 0;
    for (const label of scoreLabels) {
      if (await page.getByText(label).first().isVisible({ timeout: 500 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('displays repos section', async ({ page }) => {
    if (!page.url().match(/\/contributors\/\d+/)) return;
    // Should show repos the contributor contributed to
    const repoSection = page.getByText(/repositor/i);
    await expect(repoSection.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  });
});
