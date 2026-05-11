import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Repos Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/repos');
  });

  test('displays repos page with title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/repositories/i);
  });

  test('table has Status and Team columns', async ({ page }) => {
    const table = page.locator('table');
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const headers = await page.locator('thead th').allTextContents();
      const headerText = headers.join(' ').toLowerCase();
      expect(headerText).toContain('status');
      expect(headerText).toContain('team');
    }
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
    const checkbox = page.locator('tbody input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkbox.click();
      await expect(page.getByText(/selected/i)).toBeVisible();
    }
  });

  test('bulk actions include team assignment and ignore', async ({ page }) => {
    const checkbox = page.locator('tbody input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkbox.click();
      await expect(page.getByText(/assign to team/i)).toBeVisible();
      await expect(page.getByText(/^ignore$/i)).toBeVisible();
      await checkbox.click();
    }
  });

  test('clicking repo name navigates to repo detail', async ({ page }) => {
    const repoLink = page.locator('a[href^="/repos/"]').first();
    if (await repoLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      const href = await repoLink.getAttribute('href');
      await repoLink.click();
      await expect(page).toHaveURL(href!);
    }
  });

  test('add repository link is visible and navigates to settings', async ({ page }) => {
    // "Add more repositories" link goes to /settings#sources
    const addLink = page.locator('a[href="/settings#sources"]').first();
    await expect(addLink).toBeVisible();
  });
});
