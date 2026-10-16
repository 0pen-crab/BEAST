import { test, expect } from '@playwright/test';
import { ensureLoggedIn, skipIfEmpty } from './helpers';

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
    for (const stat of ['Running', 'In Queue', 'Completed', 'Failed', 'Avg Duration']) {
      await expect(page.getByText(stat, { exact: true }).first()).toBeVisible();
    }
  });

  test('tabs switch between queue, completed, and failed', async ({ page }) => {
    // Scoped to the tab bar: "Clear Queue" elsewhere on the page also matches /queue/.
    const tab = (name: string) => page.locator('.beast-tab-bar .beast-tab', { hasText: name });
    for (const name of ['Completed', 'Failed', 'Queue']) {
      await tab(name).click();
      await expect(tab(name)).toHaveClass(/beast-tab-active/);
    }
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
    await skipIfEmpty(page, firstRow, 'completed scans');
    await firstRow.click();

    await expect(page.getByText(/clone|analy|triage|report/i).first()).toBeVisible();
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
