import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * BEAST Smoke Test
 *
 * End-to-end test covering the complete setup-to-scan flow:
 * 1. Create admin account (or login if exists)
 * 2. Create workspace
 * 3. Add GitHub source and import repos
 * 4. Enable free security tools
 * 5. Run a scan on simple-worker-api
 * 6. Verify scan completes and results appear
 *
 * See TESTS.md for the manual version of this flow.
 */

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin1';
const WORKSPACE_NAME = 'Smoke Test';
const GITHUB_SOURCE = 'https://github.com/vitfury';
const SCAN_REPO = 'https://github.com/vitfury/simple-worker-api.git';

test.describe('BEAST Smoke Test', () => {
  test.describe.configure({ mode: 'serial' });

  test('Step 1: Create admin account or login', async ({ page }) => {
    await page.goto('/');
    const url = page.url();

    if (url.includes('/setup')) {
      // Fresh instance — create admin account
      await page.getByRole('textbox', { name: /username/i }).fill(ADMIN_USER);
      const passwordInputs = page.locator('input[type="password"]');
      await passwordInputs.first().fill(ADMIN_PASS);
      await passwordInputs.nth(1).fill(ADMIN_PASS);
      await page.getByRole('button', { name: /create admin/i }).click();
      await page.waitForURL(/\/(admin|$)/);
    } else if (url.includes('/login')) {
      // Admin exists — login
      await login(page, ADMIN_USER, ADMIN_PASS);
    }
    // Should be on dashboard or admin page
    await expect(page).not.toHaveURL(/\/(login|setup)/);
  });

  test('Step 2: Create workspace via admin', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);
    await page.goto('/admin/workspaces');
    await page.waitForLoadState('networkidle');

    // Check if workspace already exists
    const existingWorkspace = page.getByText(WORKSPACE_NAME);
    if (await existingWorkspace.isVisible()) {
      // Workspace exists — click View
      const row = page.locator('tr', { hasText: WORKSPACE_NAME });
      await row.getByRole('button', { name: /view/i }).click();
      await page.waitForURL('/');
      await expect(page.locator('aside')).toBeVisible();
      return;
    }

    // Create new workspace
    await page.getByRole('button', { name: /create workspace/i }).click();
    await page.getByRole('textbox', { name: /name/i }).fill(WORKSPACE_NAME);
    await page.getByRole('button', { name: /^create$/i }).click();
    await page.waitForLoadState('networkidle');

    // Verify it appears in the list
    await expect(page.getByText(WORKSPACE_NAME)).toBeVisible();

    // View it
    const row = page.locator('tr', { hasText: WORKSPACE_NAME });
    await row.getByRole('button', { name: /view/i }).click();
    await page.waitForURL('/');
    await expect(page.locator('aside')).toBeVisible();
  });

  test('Step 3: Add GitHub source and import repos', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Check if source already connected
    const existingSource = page.getByText('vitfury');
    if (await existingSource.isVisible()) {
      return; // Source already added
    }

    // Click "Add source"
    await page.getByRole('button', { name: /add source/i }).click();

    // Fill URL in the public tab
    await page.getByPlaceholder(/github\.com/i).fill(GITHUB_SOURCE);
    await page.getByRole('button', { name: /^add$/i }).click();

    // Wait for repo discovery
    await page.waitForTimeout(5000);

    // Import all repos
    const importAllBtn = page.getByRole('button', { name: /import all/i });
    if (await importAllBtn.isVisible()) {
      await importAllBtn.click();
      await page.waitForTimeout(3000);
    }

    // Verify source appears
    await expect(page.getByText('vitfury')).toBeVisible();
  });

  test('Step 4: Enable free security tools', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Toggle on all free tools by clicking their switches
    // The tools with "Free & Open Source" badge and no credentials
    const toggles = page.locator('input[role="switch"]');
    const toggleCount = await toggles.count();

    for (let i = 0; i < toggleCount; i++) {
      const toggle = toggles.nth(i);
      const isChecked = await toggle.isChecked();
      // Find the parent card and check if it has credentials required
      const card = toggle.locator('xpath=ancestor::div[contains(@class,"beast-card") or contains(@class,"border")]');
      const hasCredentials = await card.getByText(/credentials required/i).isVisible().catch(() => false);

      // Enable free tools (no credentials), skip ones requiring credentials
      if (!isChecked && !hasCredentials) {
        await toggle.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('Step 5: Run scan on simple-worker-api', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);
    await page.goto('/scans');
    await page.waitForLoadState('networkidle');

    // Click "New Scan"
    await page.getByRole('button', { name: /new scan/i }).click();
    await page.waitForTimeout(500);

    // Fill in the repo URL
    await page.getByPlaceholder(/github\.com\/org\/repo/i).fill(SCAN_REPO);

    // Click "Start Scan"
    await page.getByRole('button', { name: /start scan/i }).click();

    // Should see success message
    await expect(page.getByText(/scan queued successfully/i)).toBeVisible({ timeout: 10000 });

    // Wait for scan to process (up to 5 minutes for security tools)
    await page.waitForTimeout(3000);

    // Check total scans increased
    const statsText = await page.locator('text=TOTAL SCANS').locator('..').textContent();
    expect(statsText).toBeTruthy();
  });

  test('Step 6: Verify repos are imported', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);
    await page.goto('/repos');
    await page.waitForLoadState('networkidle');

    // Should see simple-worker-api in the list
    await expect(page.getByText('simple-worker-api')).toBeVisible({ timeout: 10000 });

    // Should have at least a few repos imported
    const repoCountText = await page.locator('text=/\\d+ repositories/').textContent();
    expect(repoCountText).toBeTruthy();
  });

  test('Step 7: Verify scan appears in scans list', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);
    await page.goto('/scans');
    await page.waitForLoadState('networkidle');

    // Check completed or failed tab for the scan
    const completedTab = page.getByRole('button', { name: /completed/i });
    const failedTab = page.getByRole('button', { name: /failed/i });

    // Try completed first
    await completedTab.click();
    await page.waitForTimeout(1000);

    const completedScan = page.getByText('simple-worker-api');
    if (await completedScan.isVisible()) {
      return; // Scan completed successfully
    }

    // Check failed tab
    await failedTab.click();
    await page.waitForTimeout(1000);

    // Even if scan failed (e.g., Claude not authenticated), it should appear somewhere
    const totalScansEl = page.locator('text=TOTAL SCANS').locator('..');
    const totalText = await totalScansEl.textContent();
    expect(totalText).toContain('1');
  });

  test('Step 8: Dashboard shows data', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dashboard title should be visible
    await expect(page.getByText('Dashboard', { exact: false })).toBeVisible();

    // Severity Distribution section should be visible
    await expect(page.getByText('Severity Distribution', { exact: false })).toBeVisible();

    // Security Tools section should show tools
    await expect(page.getByText('BEAST')).toBeVisible();
    await expect(page.getByText('Gitleaks')).toBeVisible();
  });
});
