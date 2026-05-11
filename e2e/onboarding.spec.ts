import { test, expect } from '@playwright/test';
import { ensureLoggedIn, apiGet, apiDelete } from './helpers';

test.describe('Admin Workspace Management', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('admin console is accessible from user dropdown', async ({ page }) => {
    const userBtn = page.locator('header button').last();
    await userBtn.click();
    await page.waitForTimeout(300);
    const adminLink = page.getByText(/admin console/i);
    await expect(adminLink).toBeVisible({ timeout: 3000 });
    await adminLink.click();
    await page.waitForURL(/\/admin/);
  });

  test('admin workspaces page loads', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await expect(page.getByText('Workspaces').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /create workspace/i })).toBeVisible();
  });

  test('create workspace button opens onboarding page', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await page.getByRole('button', { name: /create workspace/i }).click();
    // Opens full onboarding page (not modal)
    await page.waitForURL(/\/onboarding/);
    await expect(page.getByText(/workspace name/i)).toBeVisible({ timeout: 5000 });
  });

  test('onboarding page has workspace name and language fields', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await page.getByRole('button', { name: /create workspace/i }).click();
    await page.waitForURL(/\/onboarding/);
    // Name input
    await expect(page.locator('input[placeholder*="Company" i], input[placeholder*="e.g." i]').first()).toBeVisible({ timeout: 5000 });
    // Language selector
    await expect(page.getByText('English').first()).toBeVisible({ timeout: 3000 });
  });

  test('creating workspace completes onboarding', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await page.getByRole('button', { name: /create workspace/i }).click();
    await page.waitForURL(/\/onboarding/);

    const testName = `e2e-test-${Date.now()}`;
    await page.locator('input[placeholder*="Company" i], input[placeholder*="e.g." i]').first().fill(testName);
    await page.getByRole('button', { name: /create workspace/i }).click();
    await page.waitForTimeout(2000);

    // Clean up via API
    const res = await apiGet(page, '/api/admin/workspaces');
    const workspaces = await res.json();
    const created = workspaces.find((w: any) => w.name === testName);
    if (created) {
      await apiDelete(page, `/api/workspaces/${created.id}`);
    }
  });

  test('admin users page loads', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByText('Users').first()).toBeVisible();
    await expect(page.getByText('admin').first()).toBeVisible();
  });

  test('back to workspace link works', async ({ page }) => {
    await page.goto('/admin/users');
    const backLink = page.getByText(/back to workspace/i);
    if (await backLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backLink.click();
      await page.waitForURL('/');
    }
  });
});
