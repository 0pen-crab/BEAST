import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Teams Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/teams');
  });

  test('displays teams page with title', async ({ page }) => {
    await expect(page.getByText(/teams/i).first()).toBeVisible();
  });

  test('team cards are displayed or empty state shown', async ({ page }) => {
    // Either team cards or empty state
    const teamCard = page.locator('a[href^="/teams/"]').first();
    const emptyState = page.getByText(/no team/i);
    await expect(teamCard.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('clicking team card navigates to team detail', async ({ page }) => {
    const teamLink = page.locator('a[href^="/teams/"]').first();
    if (await teamLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await teamLink.click();
      await page.waitForURL(/\/teams\/\d+/);
    }
  });
});

test.describe('Team Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/teams');
    const teamLink = page.locator('a[href^="/teams/"]').first();
    if (await teamLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await teamLink.click();
      await page.waitForURL(/\/teams\/\d+/);
    }
  });

  test('displays team name', async ({ page }) => {
    if (!page.url().match(/\/teams\/\d+/)) return;
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('shows repos table or empty state', async ({ page }) => {
    if (!page.url().match(/\/teams\/\d+/)) return;
    const table = page.locator('table');
    const emptyState = page.getByText(/no repo/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('repo links navigate to repo detail', async ({ page }) => {
    if (!page.url().match(/\/teams\/\d+/)) return;
    const repoLink = page.locator('a[href^="/repos/"]').first();
    if (await repoLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      const href = await repoLink.getAttribute('href');
      await repoLink.click();
      await expect(page).toHaveURL(href!);
    }
  });
});
