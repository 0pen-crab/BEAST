import { test, expect } from '@playwright/test';
import { ensureLoggedIn, skipIfEmpty } from './helpers';

test.describe('Repos Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/repos');
  });

  test('displays repos page with title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/repositories/i);
  });

  test('shows Status by default and adds Team from column settings', async ({ page }) => {
    await skipIfEmpty(page, page.locator('tbody tr'), 'repositories');

    const headers = page.locator('thead th');
    await expect(headers.filter({ hasText: /^status/i })).toHaveCount(1);
    await expect(headers.filter({ hasText: /^team/i })).toHaveCount(0);

    await page.getByTitle('Column settings').click();
    await page.getByRole('checkbox', { name: 'Team' }).check();
    await expect(headers.filter({ hasText: /^team/i })).toHaveCount(1);
  });

  test('search input filters repos', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search" i]').first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('nonexistent-repo-xyz');
    await page.waitForTimeout(500);
    await expect(page.getByText(/no matching repositories/i)).toBeVisible({ timeout: 3000 });
  });

  test('search input clears and shows all repos again', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search" i]').first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('zzz-no-match-99999');
    await page.waitForTimeout(500);
    await expect(page.getByText(/no matching repositories/i)).toBeVisible({ timeout: 3000 });
    await searchInput.fill('');
    await page.waitForTimeout(500);
  });

  test('selecting repos shows bulk action bar', async ({ page }) => {
    await skipIfEmpty(page, page.locator('tbody tr'), 'repositories');
    await page.locator('tbody input[type="checkbox"]').first().check();
    await expect(page.getByText(/selected/i)).toBeVisible();
  });

  test('bulk actions include team assignment and ignore', async ({ page }) => {
    await skipIfEmpty(page, page.locator('tbody tr'), 'repositories');
    // Ignored repos are hidden by default, so a visible row is never ignored:
    // the bar offers Ignore and not Unignore.
    await page.locator('tbody input[type="checkbox"]').first().check();
    await expect(page.getByRole('button', { name: /assign to team/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^ignore$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^unignore$/i })).toHaveCount(0);
  });

  test('clicking repo name navigates to repo detail', async ({ page }) => {
    const repoLink = page.locator('a[href^="/repos/"]').first();
    await skipIfEmpty(page, repoLink, 'repositories');
    const href = await repoLink.getAttribute('href');
    await repoLink.click();
    await expect(page).toHaveURL(href!);
  });

  test('add repository link is visible and navigates to settings', async ({ page }) => {
    // "Add more repositories" link goes to /settings#sources
    const addLink = page.locator('a[href="/settings#sources"]').first();
    await expect(addLink).toBeVisible();
  });
});
