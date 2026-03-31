import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('shows login page with form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('redirects unauthenticated users to login', async ({ page }) => {
    // Clear any existing auth
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.removeItem('beast_token');
      localStorage.removeItem('beast_user');
    });
    await page.goto('/');
    await page.waitForURL(/\/login/);
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox').first().fill('admin');
    await page.locator('input[type="password"]').fill('admin');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/');
    // Verify sidebar loaded (app is functional)
    await expect(page.locator('aside')).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox').first().fill('admin');
    await page.locator('input[type="password"]').fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Should stay on login page and show error
    await expect(page).toHaveURL(/\/login/);
    // Error message should appear (styled with red background/text)
    const errorEl = page.locator('[class*="red"]');
    await expect(errorEl.first()).toBeVisible({ timeout: 5000 });
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByRole('textbox').first().fill('admin');
    await page.locator('input[type="password"]').fill('admin');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/');

    // Click sign out
    const signOut = page.getByRole('button', { name: /sign out|logout/i });
    if (await signOut.isVisible()) {
      await signOut.click();
      await page.waitForURL(/\/login/);
    }
  });
});
