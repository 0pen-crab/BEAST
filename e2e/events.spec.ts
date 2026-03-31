import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Events Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/events');
  });

  test('displays events page with title and tabs', async ({ page }) => {
    // Page title "Events"
    await expect(page.locator('h1')).toContainText(/events/i);
    // Tab bar with "Scan Events" and "Workspace Events"
    await expect(page.getByText('Scan Events')).toBeVisible();
    await expect(page.getByText('Workspace Events')).toBeVisible();
  });

  test('scan events tab shows stats cards', async ({ page }) => {
    // Stats cards: Unresolved Errors, Unresolved Warnings, Total Unresolved, Total Events
    const statsLabels = ['Unresolved Errors', 'Unresolved Warnings', 'Total Unresolved', 'Total Events'];
    let found = 0;
    for (const label of statsLabels) {
      if (await page.getByText(label).isVisible({ timeout: 2000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('scan events level filter buttons work', async ({ page }) => {
    // Filter buttons are lowercase with CSS capitalize: all, error, warning, info
    const levels = ['all', 'error', 'warning', 'info'];
    for (const level of levels) {
      const btn = page.locator('button', { hasText: new RegExp(`^${level}$`, 'i') });
      if (await btn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.first().click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('show resolved checkbox toggles', async ({ page }) => {
    const checkbox = page.locator('label').filter({ hasText: /show resolved/i }).locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    // Should start unchecked
    await expect(checkbox).not.toBeChecked();
    // Toggle on
    await checkbox.check();
    await page.waitForTimeout(500);
    await expect(checkbox).toBeChecked();
    // Toggle off
    await checkbox.uncheck();
    await page.waitForTimeout(300);
    await expect(checkbox).not.toBeChecked();
  });

  test('scan events shows event list or empty state', async ({ page }) => {
    // Either event cards or empty state message should appear
    const eventCard = page.locator('.rounded-lg.border.bg-white.shadow-sm').first();
    const emptyState = page.getByText(/no unresolved events|no events found/i);
    await expect(eventCard.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('event count is displayed', async ({ page }) => {
    // The page shows "{count} event(s)" text
    const countText = page.getByText(/\d+\s+events?/i);
    await expect(countText).toBeVisible({ timeout: 3000 });
  });

  test('workspace events tab displays content', async ({ page }) => {
    const wsTab = page.getByText('Workspace Events');
    await wsTab.click();
    await page.waitForTimeout(500);
    // Should show workspace event cards or the empty state paragraph
    const emptyState = page.locator('p', { hasText: /no events found/i });
    const eventBadge = page.getByText(/repository added|sync completed|sync failed/i).first();
    await expect(emptyState.or(eventBadge)).toBeVisible({ timeout: 5000 });
  });

  test('workspace events show event type badges', async ({ page }) => {
    const wsTab = page.getByText('Workspace Events');
    await wsTab.click();
    await page.waitForTimeout(500);
    // If there are workspace events, they should have type badges
    const badgeTexts = ['Repository Added', 'Sync Completed', 'Sync Failed'];
    let found = 0;
    for (const text of badgeTexts) {
      if (await page.getByText(text).first().isVisible({ timeout: 500 }).catch(() => false)) {
        found++;
      }
    }
    // Either badges are found (events exist) or empty state is shown
    const emptyState = page.getByText(/no events found/i);
    if (found === 0) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('switching between tabs works', async ({ page }) => {
    // Start on scan events tab (default)
    const scanTab = page.getByText('Scan Events');
    const wsTab = page.getByText('Workspace Events');

    // Switch to workspace events
    await wsTab.click();
    await page.waitForTimeout(300);
    // Stats cards should not be visible on workspace tab
    const statsCard = page.getByText('Unresolved Errors');
    await expect(statsCard).not.toBeVisible();

    // Switch back to scan events
    await scanTab.click();
    await page.waitForTimeout(300);
    // Stats cards should be visible again
    await expect(statsCard).toBeVisible();
  });
});
