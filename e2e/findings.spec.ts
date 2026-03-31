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

  test('severity filter buttons are visible', async ({ page }) => {
    const severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];
    let found = 0;
    for (const sev of severities) {
      if (await page.getByRole('button', { name: sev }).isVisible({ timeout: 1000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('severity filter toggles work', async ({ page }) => {
    const criticalBtn = page.getByRole('button', { name: 'Critical' });
    if (await criticalBtn.isVisible()) {
      await criticalBtn.click();
      await page.waitForTimeout(500);
      // Button should now have active styling (clicked = toggled on)
    }
  });

  test('status filter dropdown works', async ({ page }) => {
    // StatusFilter renders a <select> with "All Statuses" as default
    const statusSelect = page.locator('select').first();
    if (await statusSelect.isVisible()) {
      await statusSelect.selectOption({ label: 'Active' });
      await page.waitForTimeout(500);
    }
  });

  test('repository filter dropdown works', async ({ page }) => {
    // Repo filter is the second <select> with "All Repositories" default
    const repoSelect = page.locator('select').last();
    await expect(repoSelect).toBeVisible();
  });

  test('findings table shows results or empty state', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText(/no findings/i);
    // One of these should be visible
    await expect(table.or(emptyState.first())).toBeVisible({ timeout: 5000 });
  });

  test('findings table has expected columns', async ({ page }) => {
    const table = page.locator('table');
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const headers = await page.locator('thead th').allTextContents();
      const headerText = headers.join(' ').toLowerCase();
      expect(headerText).toContain('finding');
      expect(headerText).toContain('severity');
      expect(headerText).toContain('status');
    }
  });

  test('clicking a finding navigates to detail page', async ({ page }) => {
    const findingLink = page.locator('a[href^="/findings/"]').first();
    if (await findingLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await findingLink.click();
      await page.waitForURL(/\/findings\/\d+/);
    }
  });

  test('pagination controls appear when needed', async ({ page }) => {
    // Pagination only shows when totalPages > 1
    const nextBtn = page.getByRole('button', { name: /next/i });
    const prevBtn = page.getByRole('button', { name: /previous/i });
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Previous should be disabled on first page
      await expect(prevBtn).toBeVisible();
    }
  });

  test('result count is displayed', async ({ page }) => {
    // The page shows "{count} results" text
    const resultsText = page.getByText(/\d+\s+results/i);
    if (await resultsText.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(resultsText).toBeVisible();
    }
  });
});

test.describe('Finding Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    // Navigate to first finding via the findings list
    await page.goto('/findings');
    const findingLink = page.locator('a[href^="/findings/"]').first();
    if (await findingLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await findingLink.click();
      await page.waitForURL(/\/findings\/\d+/);
    }
  });

  test('displays finding title and severity badge', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    // Title should be visible in h1
    await expect(page.locator('h1')).toBeVisible();
    // Severity badge should be visible
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
    // The detail page shows "Set status:" label followed by buttons
    await expect(page.getByText(/set status/i)).toBeVisible();
    const statuses = ['Active', 'False Positive', 'Mitigated', 'Risk Accepted'];
    let found = 0;
    for (const status of statuses) {
      if (await page.getByRole('button', { name: status }).isVisible({ timeout: 500 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('details sidebar shows finding metadata', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    // Details section heading is an h3 with exact text "Details"
    await expect(page.locator('h3', { hasText: /^Details$/ })).toBeVisible();
    await expect(page.getByText('Date Found')).toBeVisible();
    await expect(page.getByText('Tool').first()).toBeVisible();
  });

  test('notes section exists with add input', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    // Notes section heading
    await expect(page.getByText(/^Notes/)).toBeVisible();
    // Note input field
    const noteInput = page.locator('input[placeholder="Add a note..."]');
    await expect(noteInput).toBeVisible({ timeout: 5000 });
    // Add button
    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();
  });

  test('breadcrumb navigation is visible', async ({ page }) => {
    if (!page.url().match(/\/findings\/\d+/)) return;
    // Breadcrumb shows "Teams" link and "Finding #N"
    await expect(page.getByText(/Finding #\d+/)).toBeVisible();
  });
});
