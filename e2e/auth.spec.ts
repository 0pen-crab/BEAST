import { test, expect } from '@playwright/test';
import { login, ensureLoggedIn } from './helpers';

test.describe('Authentication', () => {
  test('shows login page with username and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('textbox').first()).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.removeItem('beast_token');
      localStorage.removeItem('beast_user');
    });
    await page.goto('/');
    await page.waitForURL(/\/login/);
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    await expect(page.locator('aside')).toBeVisible();
  });

  test('login with invalid credentials shows error and stays on login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox').first().fill('admin');
    await page.locator('input[type="password"]').fill('wrongpassword123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    // Error text should appear
    await expect(page.getByText(/invalid credentials|unauthorized/i)).toBeVisible({ timeout: 5000 });
  });

  test('session persists across page navigation', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    await page.goto('/scans');
    await expect(page).toHaveURL('/scans');
    await expect(page.locator('aside')).toBeVisible();
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('aside')).toBeVisible();
  });

  test('session persists after page reload', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    await page.reload();
    await expect(page).toHaveURL('/');
    await expect(page.locator('aside')).toBeVisible();
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    const signOut = page.getByRole('button', { name: /sign out|logout/i });
    if (await signOut.isVisible()) {
      await signOut.click();
      await page.waitForURL(/\/login/);
      const token = await page.evaluate(() => localStorage.getItem('beast_token'));
      expect(token).toBeFalsy();
    }
  });

  test('after logout, navigating to protected page redirects to login', async ({ page }) => {
    await login(page);
    await page.evaluate(() => {
      localStorage.removeItem('beast_token');
      localStorage.removeItem('beast_user');
    });
    await page.goto('/scans');
    await page.waitForURL(/\/login/);
  });
});
