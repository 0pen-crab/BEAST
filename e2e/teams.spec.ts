import { test, expect } from '@playwright/test';
import { ensureLoggedIn, skipIfEmpty } from './helpers';

test.describe('Teams Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/teams');
  });

  test('displays teams page with title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/teams/i);
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
    await skipIfEmpty(page, firstRow, 'teams');
    await firstRow.click();
    await page.waitForURL(/\/teams\/\d+/);
  });
});

test.describe('Team Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/teams');
    const firstRow = page.locator('tbody tr').first();
    await skipIfEmpty(page, firstRow, 'teams');
    await firstRow.click();
    await page.waitForURL(/\/teams\/\d+/);
  });

  test('displays team name', async ({ page }) => {
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('shows repos table or empty state', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText(/no repo/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('repo links navigate to repo detail', async ({ page }) => {
    const repoLink = page.locator('main a[href^="/repos/"]').first();
    await skipIfEmpty(page, repoLink, 'repositories in this team');
    const href = await repoLink.getAttribute('href');
    await repoLink.click();
    await expect(page).toHaveURL(href!);
  });
});
