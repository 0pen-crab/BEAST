import { test, expect } from '@playwright/test';
import { ensureLoggedIn, apiGet, apiDelete } from './helpers';

test.describe('Admin Workspace Management', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('admin console is accessible from topbar', async ({ page }) => {
    const adminLink = page.locator('a[href="/admin"]');
    await expect(adminLink).toBeVisible();
    await adminLink.click();
    await page.waitForURL('/admin/users');
  });

  test('admin workspaces page loads', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await expect(page.getByText('Workspaces').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /create workspace/i })).toBeVisible();
  });

  test('create workspace button opens modal', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await page.getByRole('button', { name: /create workspace/i }).click();
    // Modal should appear with name input
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#ws-name')).toBeVisible();
  });

  test('create workspace modal has language selector', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await page.getByRole('button', { name: /create workspace/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Should have English and Ukrainian language options
    await expect(page.getByText('English').first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Ukrainian').first()).toBeVisible({ timeout: 3000 });
  });

  test('creating workspace adds it to the table', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await page.getByRole('button', { name: /create workspace/i }).click();

    const testName = `e2e-test-${Date.now()}`;
    await page.locator('#ws-name').fill(testName);
    await page.getByRole('button', { name: /^create$/i }).click();

    // Modal should close and workspace should appear in table
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(testName)).toBeVisible({ timeout: 5000 });

    // Clean up: delete the created workspace via API
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
    // Should show at least the admin user
    await expect(page.getByText('admin').first()).toBeVisible();
  });

  test('back to workspace link works', async ({ page }) => {
    await page.goto('/admin/users');
    await page.getByText(/back to workspace/i).click();
    await page.waitForURL('/');
  });
});
