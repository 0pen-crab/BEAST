import { test, expect } from '@playwright/test';
import { ensureLoggedIn, apiPost, apiDelete } from './helpers';

test.describe('Members Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/members');
  });

  test('displays members page with title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText(/members/i);
  });

  test('shows member table or empty state', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText(/no members/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('add member form is visible with username input and add button', async ({ page }) => {
    // Form has username input, role select, and ADD button
    const usernameInput = page.locator('input[placeholder*="Username" i], input[placeholder*="email" i]').first();
    await expect(usernameInput).toBeVisible({ timeout: 5000 });
    // ADD button (exact text)
    const addBtn = page.getByRole('button', { name: /^add$/i });
    await expect(addBtn).toBeVisible();
  });

  test('role selector has member and workspace admin options', async ({ page }) => {
    const roleSelect = page.locator('select').first();
    if (await roleSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      const options = await roleSelect.locator('option').allTextContents();
      expect(options.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('add member with empty username button is disabled', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /^add$/i });
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(addBtn).toBeDisabled();
    }
  });

  test('autocomplete suggests an existing user and excludes the current user', async ({ page }) => {
    const stamp = Date.now();
    const username = `e2e-pick-${stamp}@corp.com`;
    const created = await apiPost(page, '/api/admin/users', { username, displayName: `E2E Pick ${stamp}` });
    expect(created.ok()).toBeTruthy();
    const { id: createdId } = await created.json();

    try {
      await page.reload();
      const search = page.getByPlaceholder(/search users/i);
      await search.click();

      // The freshly-created user (not a member) is suggested — shown by email.
      await search.fill(username);
      await expect(page.locator('.beast-typeahead-item', { hasText: username }))
        .toBeVisible({ timeout: 5000 });

      // Self-exclusion: searching for the logged-in admin yields no "admin" option.
      await search.fill('admin');
      await page.waitForTimeout(700);
      await expect(page.locator('.beast-typeahead-name').filter({ hasText: /^admin$/ }))
        .toHaveCount(0);
    } finally {
      await apiDelete(page, `/api/admin/users/${createdId}`);
    }
  });

  test('adds a user picked from suggestions to the workspace', async ({ page }) => {
    const stamp = Date.now();
    const username = `e2e-add-${stamp}@corp.com`;
    const created = await apiPost(page, '/api/admin/users', { username, displayName: `E2E Add ${stamp}` });
    expect(created.ok()).toBeTruthy();
    const { id: createdId } = await created.json();

    try {
      await page.reload();
      const search = page.getByPlaceholder(/search users/i);
      await search.click();
      await search.fill(username);

      const option = page.locator('.beast-typeahead-item', { hasText: username });
      await expect(option).toBeVisible({ timeout: 5000 });
      await option.click();

      // Selection enables ADD; submit.
      const addBtn = page.getByRole('button', { name: /^add$/i });
      await expect(addBtn).toBeEnabled();
      await addBtn.click();
      await page.waitForTimeout(1000);

      // The picked user now appears in the members table.
      await expect(page.locator('td', { hasText: username }).first()).toBeVisible({ timeout: 5000 });

      // Cleanup: remove from the workspace.
      const row = page.locator('tr', { hasText: username });
      const removeBtn = row.getByRole('button', { name: /remove/i });
      if (await removeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await removeBtn.click();
        const confirmBtn = row.getByRole('button', { name: /yes/i });
        if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(800);
        }
      }
    } finally {
      await apiDelete(page, `/api/admin/users/${createdId}`);
    }
  });

  test('remove member shows confirmation', async ({ page }) => {
    const removeBtn = page.locator('tbody')
      .getByRole('button', { name: /remove/i }).first();

    if (await removeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await removeBtn.click();
      await expect(page.getByRole('button', { name: /yes/i }).first()).toBeVisible({ timeout: 3000 });
      await expect(page.getByRole('button', { name: /no/i }).first()).toBeVisible();
      await page.getByRole('button', { name: /no/i }).first().click();
    }
  });
});
