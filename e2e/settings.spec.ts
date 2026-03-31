import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/settings');
  });

  test('displays settings page with workspace name', async ({ page }) => {
    await expect(page.getByText(/settings/i).first()).toBeVisible();
    // Workspace name input should be pre-filled
    const nameInput = page.locator('#ws-name');
    await expect(nameInput).toBeVisible();
    const value = await nameInput.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test('language selector shows EN and UK options', async ({ page }) => {
    await expect(page.getByText('English')).toBeVisible();
    await expect(page.getByText('Ukrainian')).toBeVisible();
  });

  test('save button is disabled when no changes made', async ({ page }) => {
    const saveBtn = page.getByRole('button', { name: /save changes/i });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();
  });

  test('editing name enables save button', async ({ page }) => {
    const nameInput = page.locator('#ws-name');
    const originalValue = await nameInput.inputValue();
    await nameInput.fill(originalValue + ' test');
    const saveBtn = page.getByRole('button', { name: /save changes/i });
    await expect(saveBtn).toBeEnabled();
    // Revert change without saving
    await nameInput.fill(originalValue);
  });

  test('sources section is visible', async ({ page }) => {
    await expect(page.getByText(/sources/i).first()).toBeVisible();
  });

  test('add source button is visible', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add source/i });
    await expect(addBtn).toBeVisible();
  });

  test('clicking add source reveals source form', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add source/i });
    await addBtn.click();
    // After clicking, a form with a URL input and Cancel buttons should appear
    const urlInput = page.locator('input[placeholder]').last();
    await expect(urlInput).toBeVisible();
    const cancelBtn = page.getByRole('button', { name: /cancel/i });
    await expect(cancelBtn).toBeVisible();
    // Close form
    await cancelBtn.click();
  });

  test('danger zone has delete workspace button', async ({ page }) => {
    await expect(page.getByText(/danger zone/i)).toBeVisible();
    const deleteBtn = page.getByRole('button', { name: /delete this workspace/i });
    await expect(deleteBtn).toBeVisible();
  });
});
