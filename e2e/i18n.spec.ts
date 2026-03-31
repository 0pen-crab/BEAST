import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Internationalization', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test.afterEach(async ({ page }) => {
    // Always reset to English after each test to avoid polluting other tests
    const enButton = page.locator('button[title="English"]');
    if (await enButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await enButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('app defaults to English', async ({ page }) => {
    await page.goto('/');
    // English nav items should be visible in sidebar
    await expect(page.locator('aside').getByText('Dashboard')).toBeVisible();
    await expect(page.locator('aside').getByText('Settings')).toBeVisible();
  });

  test('language can be switched to Ukrainian', async ({ page }) => {
    await page.goto('/');
    // Click the Ukrainian language button (has title="Українська")
    const ukButton = page.locator('button[title="Українська"]');
    await expect(ukButton).toBeVisible();
    await ukButton.click();
    await page.waitForTimeout(500);

    // Nav should now be in Ukrainian
    await expect(page.locator('aside').getByText('Головна')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('aside').getByText('Налаштування')).toBeVisible({ timeout: 3000 });
  });

  test('language can be switched back to English', async ({ page }) => {
    await page.goto('/');
    // Switch to Ukrainian first
    const ukButton = page.locator('button[title="Українська"]');
    await ukButton.click();
    await page.waitForTimeout(500);
    await expect(page.locator('aside').getByText('Головна')).toBeVisible({ timeout: 3000 });

    // Switch back to English
    const enButton = page.locator('button[title="English"]');
    await enButton.click();
    await page.waitForTimeout(500);

    // Nav should be back in English
    await expect(page.locator('aside').getByText('Dashboard')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('aside').getByText('Settings')).toBeVisible({ timeout: 3000 });
  });

  test('language persists across page navigation', async ({ page }) => {
    await page.goto('/');
    // Switch to Ukrainian
    const ukButton = page.locator('button[title="Українська"]');
    await ukButton.click();
    await page.waitForTimeout(500);

    // Navigate to another page
    await page.goto('/settings');
    await page.waitForTimeout(500);

    // Should still be in Ukrainian
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Головна')).toBeVisible({ timeout: 3000 });
    await expect(sidebar.getByText('Налаштування')).toBeVisible({ timeout: 3000 });
  });

  test('language persists after page reload', async ({ page }) => {
    await page.goto('/');
    // Switch to Ukrainian
    const ukButton = page.locator('button[title="Українська"]');
    await ukButton.click();
    await page.waitForTimeout(500);
    await expect(page.locator('aside').getByText('Головна')).toBeVisible({ timeout: 3000 });

    // Reload the page
    await page.reload();
    await page.waitForTimeout(500);

    // Should still be in Ukrainian (stored in localStorage as beast_language)
    await expect(page.locator('aside').getByText('Головна')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('aside').getByText('Налаштування')).toBeVisible({ timeout: 3000 });
  });
});
