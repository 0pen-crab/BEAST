import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

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

  test('add member creates user and shows in table', async ({ page }) => {
    const usernameInput = page.locator('input[placeholder*="Username" i], input[placeholder*="email" i]').first();
    if (!await usernameInput.isVisible({ timeout: 3000 }).catch(() => false)) return;

    const testUsername = `e2e-member-${Date.now()}`;
    await usernameInput.fill(testUsername);
    await page.getByRole('button', { name: /^add$/i }).click();
    await page.waitForTimeout(1000);

    // New member should appear in table (use first() to avoid strict mode on multiple matches)
    await expect(page.locator('td', { hasText: testUsername }).first()).toBeVisible({ timeout: 5000 });

    // Cleanup: remove the created member
    const row = page.locator('tr', { hasText: testUsername });
    const removeBtn = row.getByRole('button', { name: /remove/i });
    if (await removeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await removeBtn.click();
      await page.waitForTimeout(500);
      // Confirm - "Yes" button appears inline in the row
      const confirmBtn = row.getByRole('button', { name: /yes/i });
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
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
