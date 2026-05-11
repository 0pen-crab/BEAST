import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Scans Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/scans');
  });

  test('displays page title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/scans/i);
  });

  test('displays scan stats bar with total scans', async ({ page }) => {
    await expect(page.getByText(/total scans/i)).toBeVisible({ timeout: 5000 });
  });

  test('displays running, completed, failed, and avg duration stats', async ({ page }) => {
    const stats = ['Running', 'In Queue', 'Completed', 'Failed', 'Avg Duration'];
    let found = 0;
    for (const stat of stats) {
      if (await page.getByText(stat, { exact: false }).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(3);
  });

  test('tabs switch between queue, completed, and failed', async ({ page }) => {
    const queueTab = page.getByRole('button', { name: /queue/i }).first();
    await expect(queueTab).toBeVisible();

    const completedTab = page.getByRole('button', { name: /completed/i }).first();
    if (await completedTab.isVisible()) {
      await completedTab.click();
      await page.waitForTimeout(300);
    }

    const failedTab = page.getByRole('button', { name: /failed/i }).first();
    if (await failedTab.isVisible()) {
      await failedTab.click();
      await page.waitForTimeout(300);
    }

    await queueTab.click();
  });

  test('completed scans tab shows table or empty state', async ({ page }) => {
    const completedTab = page.getByRole('button', { name: /completed/i }).first();
    await expect(completedTab).toBeVisible();
    await completedTab.click();

    const table = page.locator('table');
    const emptyState = page.getByText(/no completed scans/i);
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: 5000 });
  });

  test('completed scans show pipeline details on row expand', async ({ page }) => {
    const completedTab = page.getByRole('button', { name: /completed/i }).first();
    await expect(completedTab).toBeVisible();
    await completedTab.click();

    const firstRow = page.locator('tbody tr').first();
    const hasRows = await firstRow.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasRows) return;

    await firstRow.click();

    const stagePatterns = [/clone/i, /analy/i, /triage/i, /report/i];
    let foundStage = false;
    for (const pattern of stagePatterns) {
      if (await page.getByText(pattern).first().isVisible({ timeout: 1000 }).catch(() => false)) {
        foundStage = true;
        break;
      }
    }
    expect(foundStage).toBe(true);
  });

  test('failed scans tab shows table or empty state', async ({ page }) => {
    const failedTab = page.getByRole('button', { name: /failed/i }).first();
    await expect(failedTab).toBeVisible();
    await failedTab.click();

    const table = page.locator('table');
    const emptyState = page.getByText(/no failed scans/i);
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: 5000 });
  });
});
