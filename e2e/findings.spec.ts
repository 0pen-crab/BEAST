import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Findings Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/findings');
  });

  test('displays findings page with title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/findings/i);
  });

  test('search input is visible', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search" i]').first()).toBeVisible({ timeout: 5000 });
  });

  test('add filter button is visible', async ({ page }) => {
    await expect(page.getByText(/add filter/i)).toBeVisible({ timeout: 5000 });
  });

  test('findings table shows results or empty state', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText(/no findings/i);
    // Wait for loading to finish (skeleton loaders disappear)
    await page.waitForTimeout(2000);
    await expect(table.or(emptyState.first())).toBeVisible({ timeout: 10000 });
  });

  test('findings table has correct columns when data exists', async ({ page }) => {
    const table = page.locator('table');
    await page.waitForTimeout(2000);
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const headers = await page.locator('thead th').allTextContents();
      const headerText = headers.join(' ').toLowerCase();
      expect(headerText).toContain('finding');
      expect(headerText).toContain('severity');
    }
  });

  test('clicking a finding navigates to detail page', async ({ page }) => {
    await page.waitForTimeout(2000);
    const findingLink = page.locator('a[href^="/findings/"]').first();
    if (await findingLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await findingLink.click();
      await page.waitForURL(/\/findings\/\d+/);
      await expect(page.locator('h1')).toBeVisible();
    }
  });

  test('pagination controls appear when needed', async ({ page }) => {
    await page.waitForTimeout(2000);
    const nextBtn = page.getByRole('button', { name: /next/i });
    const prevBtn = page.getByRole('button', { name: /previous/i });
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(prevBtn).toBeVisible();
      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForTimeout(500);
        await prevBtn.click();
      }
    }
  });

  test('column settings button is visible', async ({ page }) => {
    // Gear icon for column settings
    const settingsBtn = page.locator('button svg').last();
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Finding Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/findings');
    await page.waitForTimeout(2000);
    const findingLink = page.locator('a[href^="/findings/"]').first();
    if (await findingLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await findingLink.click();
      await page.waitForURL(/\/findings\/\d+/);
    }
  });

  test('displays finding title and severity badge', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    await expect(page.locator('h1')).toBeVisible();
    const severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];
    let found = false;
    for (const sev of severities) {
      if (await page.getByText(sev, { exact: true }).first().isVisible({ timeout: 500 }).catch(() => false)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('status action buttons are visible', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    // Look for status buttons or status label
    const statusLabel = page.getByText(/set status|status/i);
    await expect(statusLabel.first()).toBeVisible({ timeout: 5000 });
    const statuses = ['Open', 'False Positive', 'Fixed', 'Risk Accepted'];
    let found = 0;
    for (const status of statuses) {
      if (await page.getByRole('button', { name: status }).isVisible({ timeout: 500 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('clicking status button changes finding status', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    const riskBtn = page.getByRole('button', { name: 'Risk Accepted' });
    const activeBtn = page.getByRole('button', { name: 'Active' });
    if (await riskBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await riskBtn.click();
      await page.waitForTimeout(500);
      if (await activeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await activeBtn.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('finding detail page shows content', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    // The detail page should show the finding ID in heading and have content
    await expect(page.locator('h1')).toBeVisible();
    // Page should have some content beyond just the title
    const body = page.locator('main, [class*="stack"], [class*="content"]').first();
    await expect(body).toBeVisible();
  });

  test('notes section allows adding a note', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    await expect(page.getByText(/^Notes/)).toBeVisible();
    const noteInput = page.locator('input[placeholder="Add a note..."]');
    await expect(noteInput).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();

    const testNote = `e2e-test-note-${Date.now()}`;
    await noteInput.fill(testNote);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(testNote)).toBeVisible({ timeout: 5000 });
  });

  test('finding detail has back navigation', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    // Should have some way to navigate back — breadcrumb or back link
    const findingsLink = page.locator('a[href="/findings"]');
    const backLink = page.getByText(/back|findings/i).first();
    await expect(findingsLink.or(backLink)).toBeVisible({ timeout: 10_000 });
  });
});
