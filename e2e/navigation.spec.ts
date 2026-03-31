import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Navigation & Layout', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('sidebar shows all nav links', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    const navLinks = ['Dashboard', 'Scans', 'Repos', 'Events', 'Findings', 'Contributors', 'Teams', 'Members', 'Settings'];
    for (const link of navLinks) {
      await expect(sidebar.getByText(link, { exact: false })).toBeVisible();
    }
  });

  test('clicking nav links navigates to correct pages', async ({ page }) => {
    const routes = [
      { text: 'Scans', url: '/scans' },
      { text: 'Repos', url: '/repos' },
      { text: 'Events', url: '/events' },
      { text: 'Findings', url: '/findings' },
      { text: 'Contributors', url: '/contributors' },
      { text: 'Teams', url: '/teams' },
      { text: 'Members', url: '/members' },
      { text: 'Settings', url: '/settings' },
      { text: 'Dashboard', url: '/' },
    ];

    for (const route of routes) {
      await page.locator('aside nav').getByText(route.text, { exact: false }).click();
      await expect(page).toHaveURL(route.url);
    }
  });

  test('workspace switcher shows current workspace', async ({ page }) => {
    const sidebar = page.locator('aside');
    // The workspace trigger button contains an orange badge span and workspace name
    const wsButton = sidebar.locator('button').filter({ has: page.locator('span.bg-orange-600') }).first();
    await expect(wsButton).toBeVisible();
  });

  test('workspace switcher dropdown opens and lists workspaces', async ({ page }) => {
    const sidebar = page.locator('aside');
    // Click the workspace trigger button (has the orange badge)
    const wsButton = sidebar.locator('button').filter({ has: page.locator('span.bg-orange-600') }).first();
    await wsButton.click();

    // Dropdown should appear with create workspace button
    await expect(page.getByText(/create workspace/i)).toBeVisible();
  });

  test('BEAST brand links to dashboard', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings');
    // The first link in the sidebar is the BEAST brand link
    await page.locator('aside a').first().click();
    await expect(page).toHaveURL('/');
  });

  test('404 page shows for invalid routes', async ({ page }) => {
    await page.goto('/nonexistent-route-12345');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});
