import { test, expect } from '@playwright/test';
import { ensureLoggedIn, skipIfEmpty } from './helpers';

test.describe('Findings Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/findings');
  });

  test('displays findings page with title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/findings/i);
  });

  test('search input is visible', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search" i]').first()).toBeVisible();
  });

  test('add filter button is visible', async ({ page }) => {
    await expect(page.getByText(/add filter/i)).toBeVisible();
  });

  test('findings table shows results or empty state', async ({ page }) => {
    await expect(page.locator('table').or(page.locator('.beast-empty'))).toBeVisible();
  });

  test('findings table has correct columns when data exists', async ({ page }) => {
    await skipIfEmpty(page, page.locator('tbody tr'), 'findings');
    const headerText = (await page.locator('thead th').allTextContents()).join(' ').toLowerCase();
    expect(headerText).toContain('finding');
    expect(headerText).toContain('severity');
  });

  test('clicking a finding navigates to detail page', async ({ page }) => {
    const findingLink = page.locator('a[href^="/findings/"]').first();
    await skipIfEmpty(page, findingLink, 'findings');
    await findingLink.click();
    await page.waitForURL(/\/findings\/\d+/);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('pagination moves forward and back', async ({ page }) => {
    await skipIfEmpty(page, page.locator('tbody tr'), 'findings');
    const nextBtn = page.getByRole('button', { name: /next/i });
    const prevBtn = page.getByRole('button', { name: /previous/i });
    test.skip(!(await nextBtn.isVisible()), 'all findings fit on one page, so there is no pagination');

    await expect(prevBtn).toBeVisible();
    test.skip(!(await nextBtn.isEnabled()), 'already on the last page');
    await nextBtn.click();
    await expect(prevBtn).toBeEnabled();
    await prevBtn.click();
    await expect(nextBtn).toBeEnabled();
  });

  test('column settings button is visible', async ({ page }) => {
    await expect(page.getByTitle('Column settings')).toBeVisible();
  });
});

test.describe('Finding Detail Page', () => {
  const statusBadge = '.beast-status-clickable';
  const statusMenu = '.beast-status-dropdown';
  const restorableStatuses = ['Open', 'False Positive', 'Fixed', 'Risk Accepted'];

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/findings');
    const findingLink = page.locator('a[href^="/findings/"]').first();
    await skipIfEmpty(page, findingLink, 'findings');
    await findingLink.click();
    await page.waitForURL(/\/findings\/\d+/);
  });

  test('displays finding title and severity badge', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText(/^(Critical|High|Medium|Low|Info)$/).first()).toBeVisible();
  });

  test('status menu offers every status except the current one', async ({ page }) => {
    const badge = page.locator(statusBadge);
    const current = (await badge.innerText()).replace(/[▲▼]/g, '').trim();
    await badge.click();

    const options = page.locator(statusMenu).getByRole('button');
    const labels = (await options.allInnerTexts()).map((l) => l.trim());
    expect(labels).not.toContain(current);
    expect(labels.length).toBe(restorableStatuses.filter((s) => s !== current).length);
  });

  test('changing the status updates the badge and can be reverted', async ({ page }) => {
    const badge = page.locator(statusBadge);
    const original = (await badge.innerText()).replace(/[▲▼]/g, '').trim();
    test.skip(!restorableStatuses.includes(original), `status "${original}" cannot be restored from the UI`);
    const target = original === 'Risk Accepted' ? 'Open' : 'Risk Accepted';

    await badge.click();
    await page.locator(statusMenu).getByRole('button', { name: target }).click();
    await expect(badge).toContainText(target);

    // Put the finding back so the test leaves no trace in the data.
    await badge.click();
    await page.locator(statusMenu).getByRole('button', { name: original }).click();
    await expect(badge).toContainText(original);
  });

  test('finding detail page shows content', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.beast-props')).toBeVisible();
  });

  test('notes section allows adding a note', async ({ page }) => {
    await expect(page.getByText(/^Notes/)).toBeVisible();
    const noteInput = page.locator('input[placeholder="Add a note..."]');
    await expect(noteInput).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();

    const testNote = `e2e-test-note-${Date.now()}`;
    await noteInput.fill(testNote);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(testNote)).toBeVisible();
  });

  test('breadcrumb leads back to the findings list', async ({ page }) => {
    const back = page.locator('.beast-breadcrumb a[href="/findings"]');
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/findings$/);
  });
});
