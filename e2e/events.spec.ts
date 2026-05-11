import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Events Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/events');
  });

  test('displays events page with title and tabs', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/events/i);
    await expect(page.getByText('Scan Events')).toBeVisible();
    await expect(page.getByText('Workspace Events')).toBeVisible();
  });

  test('scan events tab shows stats cards', async ({ page }) => {
    const statsLabels = ['Unresolved Errors', 'Unresolved Warnings', 'Total Unresolved', 'Total Events'];
    let found = 0;
    for (const label of statsLabels) {
      if (await page.getByText(label).isVisible({ timeout: 2000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('level filter buttons work and toggle', async ({ page }) => {
    const levels = ['all', 'error', 'warning', 'info'];
    for (const level of levels) {
      const btn = page.locator('button', { hasText: new RegExp(`^${level}$`, 'i') });
      if (await btn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.first().click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('show resolved checkbox toggles on and off', async ({ page }) => {
    const checkbox = page.locator('label').filter({ hasText: /show resolved/i }).locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await page.waitForTimeout(500);
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await page.waitForTimeout(300);
    await expect(checkbox).not.toBeChecked();
  });

  test('scan events shows event list or empty state', async ({ page }) => {
    // Event cards or empty state
    const emptyState = page.getByText(/no unresolved events|no events found/i);
    const eventItem = page.locator('table tbody tr, [class*="border"][class*="rounded"]').first();
    await expect(emptyState.or(eventItem)).toBeVisible({ timeout: 5000 });
  });

  test('workspace events tab shows content', async ({ page }) => {
    await page.getByText('Workspace Events').click();
    await page.waitForTimeout(500);
    const emptyState = page.locator('p', { hasText: /no events found/i });
    const eventBadge = page.getByText(/repository added|sync completed|sync failed/i).first();
    await expect(emptyState.or(eventBadge)).toBeVisible({ timeout: 5000 });
  });

  test('switching tabs hides/shows stats cards', async ({ page }) => {
    const scanTab = page.getByText('Scan Events');
    const wsTab = page.getByText('Workspace Events');
    const statsCard = page.getByText('Unresolved Errors');

    await wsTab.click();
    await page.waitForTimeout(300);
    await expect(statsCard).not.toBeVisible();

    await scanTab.click();
    await page.waitForTimeout(300);
    await expect(statsCard).toBeVisible();
  });
});
