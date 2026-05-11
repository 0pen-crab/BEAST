import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto('/settings');
  });

  test('displays settings with workspace name filled', async ({ page }) => {
    await expect(page.getByText(/settings/i).first()).toBeVisible();
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

  test('editing workspace name enables save button', async ({ page }) => {
    const nameInput = page.locator('#ws-name');
    const originalValue = await nameInput.inputValue();
    await nameInput.fill(originalValue + ' test');
    const saveBtn = page.getByRole('button', { name: /save changes/i });
    await expect(saveBtn).toBeEnabled();
    await nameInput.fill(originalValue);
  });

  test('save workspace name change and verify persistence', async ({ page }) => {
    const nameInput = page.locator('#ws-name');
    const originalValue = await nameInput.inputValue();
    const newName = originalValue + '-e2e';

    await nameInput.fill(newName);
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(1000);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#ws-name')).toHaveValue(newName);

    // Revert
    await page.locator('#ws-name').fill(originalValue);
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(500);
  });

  test('sources section is visible', async ({ page }) => {
    await expect(page.getByText(/sources/i).first()).toBeVisible();
  });

  test('add source button is visible', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add source/i });
    await expect(addBtn).toBeVisible();
  });

  test('danger zone has delete workspace button', async ({ page }) => {
    await expect(page.getByText(/danger zone/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /delete this workspace/i })).toBeVisible();
  });

  test('security tools section shows known tools', async ({ page }) => {
    const toolNames = ['BEAST', 'Gitleaks', 'Trivy', 'Trufflehog'];
    let found = 0;
    for (const tool of toolNames) {
      if (await page.getByText(tool).first().isVisible({ timeout: 1000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
