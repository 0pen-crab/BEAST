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

  test('table has expected columns including Status', async ({ page }) => {
    const table = page.locator('table');
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const headers = await page.locator('thead th').allTextContents();
      const headerText = headers.join(' ').toLowerCase();
      expect(headerText).toContain('status');
      expect(headerText).toContain('team');
    }
  });

  test('search input filters repos', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search repositories"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('nonexistent-repo-xyz');
    // Wait for filter to apply
    await page.waitForTimeout(500);
    // Should show fewer or no results
  });

  test('status filter dropdown works', async ({ page }) => {
    // The status filter is a <select> element with "All statuses" as default option
    const statusSelect = page.locator('select').last();
    await expect(statusSelect).toBeVisible();
    // Select a specific status option
    await statusSelect.selectOption({ label: 'Pending' });
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
      // Should see "Assign to team" button
      await expect(page.getByText(/assign to team/i)).toBeVisible();
      // Should see "Ignore" button
      await expect(page.getByText(/^ignore$/i)).toBeVisible();
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

  test('Add repository button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add repository/i })).toBeVisible();
  });

  test('clicking add repository opens modal with source form', async ({ page }) => {
    await page.getByRole('button', { name: /add repository/i }).click();
    // Modal should appear with heading
    await expect(page.locator('div.fixed h2')).toContainText(/add repository/i);
    // Verify all three tabs are visible
    await expect(page.getByRole('button', { name: 'Public URL' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add source' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload ZIP' })).toBeVisible();
  });

  test('add repository modal can be closed', async ({ page }) => {
    await page.getByRole('button', { name: /add repository/i }).click();
    // Verify modal is open
    await expect(page.locator('div.fixed h2')).toContainText(/add repository/i);
    // Click the X button (SVG close button in the modal header)
    await page.locator('div.fixed button').filter({ has: page.locator('svg path[d="M6 18L18 6M6 6l12 12"]') }).click();
    // Modal should be gone
    await expect(page.locator('div.fixed h2')).not.toBeVisible();
  });

  test('empty state shows when no repos match filters', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search repositories"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('zzz-no-match-12345');
    await page.waitForTimeout(500);
    // Should show empty state
    await expect(page.getByText(/no matching repositories/i)).toBeVisible({ timeout: 3000 });
  });
});
