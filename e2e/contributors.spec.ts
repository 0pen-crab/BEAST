import { test, expect } from '@playwright/test';
import { ensureLoggedIn, skipIfEmpty } from './helpers';

test.describe('Contributors Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/contributors');
  });

  test('displays contributors page with title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/contributors/i);
  });

  test('search filters the table and clearing it restores the list', async ({ page }) => {
    const rows = page.locator('tbody tr');
    await skipIfEmpty(page, rows, 'contributors');
    const total = await rows.count();
    const search = page.getByPlaceholder(/search by name or email/i);

    await search.fill('zzz-nonexistent-contributor');
    await expect(rows).toHaveCount(0);
    await search.fill('');
    await expect(rows).toHaveCount(total);
  });

  test('clicking the Contributor header sorts by name both ways', async ({ page }) => {
    const rows = page.locator('tbody tr');
    await skipIfEmpty(page, rows, 'contributors');
    test.skip((await rows.count()) < 2, 'sorting needs at least two contributors');
    const names = async () => (await page.locator('tbody tr td:nth-child(2)').allInnerTexts()).map((n) => n.trim());
    const header = page.locator('thead').getByRole('button', { name: /contributor/i });

    await header.click();
    const first = await names();
    await header.click();
    await expect.poll(names).toEqual([...first].reverse());
  });

  test('contributors table or empty state shown', async ({ page }) => {
    await expect(page.locator('table').or(page.locator('.beast-empty'))).toBeVisible();
  });

  test('clicking contributor navigates to profile page', async ({ page }) => {
    const contributorLink = page.locator('a[href^="/contributors/"]').first();
    await skipIfEmpty(page, contributorLink, 'contributors');
    await contributorLink.click();
    await page.waitForURL(/\/contributors\/\d+/);
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('Contributor Profile Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/contributors');
    const contributorLink = page.locator('a[href^="/contributors/"]').first();
    await skipIfEmpty(page, contributorLink, 'contributors');
    await contributorLink.click();
    await page.waitForURL(/\/contributors\/\d+/);
  });

  test('displays contributor name', async ({ page }) => {
    await expect(page.locator('h1.beast-profile-name')).not.toBeEmpty();
  });

  test('shows the overall score and the code quality assessment', async ({ page }) => {
    // The score is a number, or "Not assessed" for contributors the AI has not scored yet.
    await expect(page.locator('.beast-profile-score')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Code Quality Assessment' })).toBeVisible();
  });

  test('displays repositories section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /contributing to \d+ repositor/i })).toBeVisible();
  });

  test('breadcrumb returns to contributors list', async ({ page }) => {
    await page.locator('.beast-breadcrumb a[href="/contributors"]').click();
    await expect(page).toHaveURL(/\/contributors$/);
  });
});
