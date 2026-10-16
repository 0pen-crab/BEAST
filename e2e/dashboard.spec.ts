import { test, expect } from '@playwright/test';
import { ensureLoggedIn, skipIfEmpty } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/');
  });

  test('displays page title', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
  });

  test('severity distribution section is visible', async ({ page }) => {
    await expect(page.getByText(/severity distribution/i)).toBeVisible();
  });

  test('tools section shows tool categories', async ({ page }) => {
    // Tool categories: Code Analysis, Dependencies, Infrastructure, Secrets, Personal Data
    await expect(page.locator('main').getByText(/^(Code Analysis|Dependencies|Infrastructure|Secrets|Personal Data)$/).first()).toBeVisible();
  });

  test('recent scans section is visible', async ({ page }) => {
    await expect(page.getByText(/recent scans/i)).toBeVisible();
  });

  test('a recent scan opens that scan on the scans page', async ({ page }) => {
    const scanLink = page.locator('main a[href^="/scans?scan="]').first();
    await skipIfEmpty(page, scanLink, 'scans');
    const href = await scanLink.getAttribute('href');
    await scanLink.click();
    await expect(page).toHaveURL(href!);
  });

  test('repositories section is visible', async ({ page }) => {
    await expect(page.getByText(/repositories/i).first()).toBeVisible();
  });

  test('repo link navigates to repo detail page', async ({ page }) => {
    const repoLink = page.locator('main a[href^="/repos/"]').first();
    await skipIfEmpty(page, repoLink, 'repositories');
    const href = await repoLink.getAttribute('href');
    await repoLink.click();
    await expect(page).toHaveURL(href!);
  });
});
