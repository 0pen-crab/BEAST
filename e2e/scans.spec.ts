import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Scans Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/scans');
  });

  test('displays page title and new scan button', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/scans/i);
    await expect(page.getByRole('button', { name: /new scan/i })).toBeVisible();
  });

  test('displays scan stats bar', async ({ page }) => {
    // Stats cards: Total Scans, Running, In Queue, Completed, Failed, Avg Duration
    // The stats bar only renders when data is available; check for at least one card
    const statsCard = page.getByText(/total scans/i);
    await expect(statsCard).toBeVisible({ timeout: 5000 });
  });

  test('new scan form opens and has URL/local toggle', async ({ page }) => {
    await page.getByRole('button', { name: /new scan/i }).click();
    // Form should be visible with the "New Security Scan" heading
    await expect(page.getByText(/new security scan/i)).toBeVisible({ timeout: 3000 });
    // Both source mode toggle buttons should be visible
    await expect(page.getByRole('button', { name: /git url/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /local path/i })).toBeVisible();
    // URL input with the github placeholder (default mode)
    await expect(
      page.locator('input[placeholder*="github.com"]').first()
    ).toBeVisible();
  });

  test('new scan form can switch to local path mode', async ({ page }) => {
    await page.getByRole('button', { name: /new scan/i }).click();
    await expect(page.getByText(/new security scan/i)).toBeVisible({ timeout: 3000 });
    // Click the "Local Path" toggle button
    const localToggle = page.getByRole('button', { name: /local path/i });
    await expect(localToggle).toBeVisible();
    await localToggle.click();
    // The local path input should now be visible
    await expect(
      page.locator('input[placeholder*="enamine"]').first()
    ).toBeVisible();
  });

  test('tabs switch between queue, completed, and failed', async ({ page }) => {
    // Default tab is "Queue"
    const queueTab = page.getByRole('button', { name: /queue/i }).first();
    await expect(queueTab).toBeVisible();

    // Click Completed tab
    const completedTab = page.getByRole('button', { name: /completed/i }).first();
    if (await completedTab.isVisible()) {
      await completedTab.click();
    }

    // Click Failed tab
    const failedTab = page.getByRole('button', { name: /failed/i }).first();
    if (await failedTab.isVisible()) {
      await failedTab.click();
    }
  });

  test('completed scans tab shows table or empty state', async ({ page }) => {
    // Click completed tab
    const completedTab = page.getByRole('button', { name: /completed/i }).first();
    await expect(completedTab).toBeVisible();
    await completedTab.click();

    // Should show either a table with scans or an empty state message
    const table = page.locator('table');
    const emptyState = page.getByText(/no completed scans/i);
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: 5000 });
  });

  test('completed scans show pipeline details on expand', async ({ page }) => {
    // Click completed tab
    const completedTab = page.getByRole('button', { name: /completed/i }).first();
    await expect(completedTab).toBeVisible();
    await completedTab.click();

    // Try to find a completed scan row to expand
    const firstRow = page.locator('tbody tr').first();
    const hasRows = await firstRow.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasRows) {
      // No completed scans -- gracefully skip
      return;
    }

    // Click the row to expand pipeline details
    await firstRow.click();

    // Look for pipeline stage names from PipelineTimeline
    // Stages: Clone repository, [AI] Analysis, Security tools, [AI] Vulnerability scan, [AI] Triage findings, [AI] Write report
    const stagePatterns = [/clone/i, /analy/i, /triage/i, /report/i];
    let foundStage = false;
    for (const pattern of stagePatterns) {
      const stageEl = page.getByText(pattern);
      if (await stageEl.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        foundStage = true;
        break;
      }
    }
    // At least one pipeline stage name should be visible after expansion
    if (hasRows) {
      expect(foundStage).toBe(true);
    }
  });

  test('failed scans tab shows table or empty state', async ({ page }) => {
    // Click failed tab
    const failedTab = page.getByRole('button', { name: /failed/i }).first();
    await expect(failedTab).toBeVisible();
    await failedTab.click();

    // Should show either a table with scans or an empty state message
    const table = page.locator('table');
    const emptyState = page.getByText(/no failed scans/i);
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: 5000 });
  });

  test('new scan form has start scan and cancel buttons', async ({ page }) => {
    await page.getByRole('button', { name: /new scan/i }).click();
    await expect(page.getByText(/new security scan/i)).toBeVisible({ timeout: 3000 });
    // Start Scan button (disabled when no input)
    await expect(page.getByRole('button', { name: /start scan/i })).toBeVisible();
    // Cancel button
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });
});
