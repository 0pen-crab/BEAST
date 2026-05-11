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

  test('teams table or empty state shown', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText(/no team/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('create team button is visible', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: /create team/i });
    await expect(createBtn).toBeVisible();
  });

  test('clicking team row navigates to team detail', async ({ page }) => {
    // Teams are table rows with click handler, not links
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForURL(/\/teams\/\d+/);
    }
  });
});

test.describe('Team Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/teams');
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
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
