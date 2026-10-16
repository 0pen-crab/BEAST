import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Navigation & Layout', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('sidebar shows all nav links', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    const navLinks = ['Dashboard', 'Repositories', 'Scans', 'Findings', 'Events', 'Contributors', 'Teams', 'Members', 'Settings'];
    for (const link of navLinks) {
      await expect(sidebar.getByText(link, { exact: false })).toBeVisible();
    }
  });

  test('clicking nav links navigates to correct pages', async ({ page }) => {
    // Settings is a parent link with sub-pages (general, ai, tools) — accept either form.
    // Click via href because Events has a count-badge child ("Events 40") so getByText
    // doesn't match cleanly with exact:true.
    const routes: Array<{ href: string; url: RegExp | string }> = [
      { href: '/scans', url: '/scans' },
      { href: '/repos', url: '/repos' },
      { href: '/events', url: '/events' },
      { href: '/findings', url: '/findings' },
      { href: '/contributors', url: '/contributors' },
      { href: '/teams', url: '/teams' },
      { href: '/members', url: '/members' },
      { href: '/settings/general', url: /\/settings(\/.*)?$/ },
      { href: '/', url: 'http://localhost:8000/' },
    ];

    for (const route of routes) {
      await page.locator(`aside nav a[href="${route.href}"]`).first().click();
      await expect(page).toHaveURL(route.url);
    }
  });

  test('workspace switcher is visible', async ({ page }) => {
    const sidebar = page.locator('aside');
    // Workspace switcher button with workspace name
    const wsButton = sidebar.locator('button').filter({ has: page.locator('span.bg-beast-red') }).first();
    // Fall back to any workspace button in sidebar header
    const altWsButton = sidebar.locator('button').first();
    await expect(wsButton.or(altWsButton)).toBeVisible();
  });

  test('workspace switcher dropdown opens', async ({ page }) => {
    const sidebar = page.locator('aside');
    // Click workspace trigger (first button in sidebar)
    const wsButton = sidebar.locator('button').first();
    await wsButton.click();
    // Dropdown should appear with create workspace option
    await expect(page.getByText(/create workspace/i)).toBeVisible({ timeout: 3000 });
  });

  test('BEAST brand links to dashboard', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings');
    await page.locator('aside a').first().click();
    await expect(page).toHaveURL('/');
  });

  test('404 page shows for invalid routes', async ({ page }) => {
    await page.goto('/nonexistent-route-12345');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});
