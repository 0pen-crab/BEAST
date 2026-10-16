import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

// Helper to open user dropdown menu in topbar
async function openUserMenu(page: import('@playwright/test').Page) {
  // Click the user menu button (contains avatar initial + username)
  const userBtn = page.locator('header button').last();
  await userBtn.click();
  await page.waitForTimeout(300);
}

test.describe('Internationalization', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test.afterEach(async ({ page }) => {
    // Reset to English via localStorage (reliable, no UI interaction needed)
    await page.evaluate(() => localStorage.setItem('beast_language', 'en'));
  });

  test('app defaults to English', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside').getByText('Dashboard')).toBeVisible();
    await expect(page.locator('aside').getByText('Settings', { exact: true }).first()).toBeVisible();
  });

  test('language can be switched to Ukrainian via user menu', async ({ page }) => {
    await page.goto('/');
    await openUserMenu(page);
    // Click Ukrainian flag
    await page.getByText('🇺🇦').click();
    await page.waitForTimeout(500);

    // Nav should be in Ukrainian
    await expect(page.locator('aside').getByText('Головна')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('aside').getByText('Налаштування', { exact: true }).first()).toBeVisible({ timeout: 3000 });
  });

  test('language can be switched back to English', async ({ page }) => {
    await page.goto('/');
    // Switch to Ukrainian first
    await openUserMenu(page);
    await page.getByText('🇺🇦').click();
    await page.waitForTimeout(1000);
    await expect(page.locator('aside').getByText('Головна')).toBeVisible({ timeout: 3000 });

    // Reset via localStorage directly (more reliable than clicking through menu again)
    await page.evaluate(() => localStorage.setItem('beast_language', 'en'));
    await page.reload();
    await page.waitForTimeout(1000);

    await expect(page.locator('aside').getByText('Dashboard')).toBeVisible({ timeout: 5000 });
  });

  test('language persists across page navigation', async ({ page }) => {
    await page.goto('/');
    await openUserMenu(page);
    await page.getByText('🇺🇦').click();
    await page.waitForTimeout(500);

    await page.goto('/settings');
    await page.waitForTimeout(500);

    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Головна')).toBeVisible({ timeout: 3000 });
    await expect(sidebar.getByText('Налаштування', { exact: true }).first()).toBeVisible({ timeout: 3000 });
  });

  test('language persists after page reload', async ({ page }) => {
    await page.goto('/');
    await openUserMenu(page);
    await page.getByText('🇺🇦').click();
    await page.waitForTimeout(500);
    await expect(page.locator('aside').getByText('Головна')).toBeVisible({ timeout: 3000 });

    await page.reload();
    await page.waitForTimeout(500);

    await expect(page.locator('aside').getByText('Головна')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('aside').getByText('Налаштування', { exact: true }).first()).toBeVisible({ timeout: 3000 });
  });
});
