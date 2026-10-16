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
    await expect(nameInput).not.toHaveValue('');
    const originalValue = await nameInput.inputValue();
    const newName = originalValue + '-e2e';
    const save = async (value: string) => {
      await page.locator('#ws-name').fill(value);
      const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/workspaces\/\d+$/.test(r.url()));
      await page.getByRole('button', { name: /save changes/i }).click();
      expect((await saved).ok()).toBe(true);
    };

    await save(newName);
    await page.reload();
    await expect(page.locator('#ws-name')).toHaveValue(newName);

    // Revert, and wait for it to land — otherwise the workspace can stay renamed.
    await save(originalValue);
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
    await page.goto('/settings/tools');
    await expect(page.locator('main').getByText(/BEAST|Gitleaks|Trivy|TruffleHog/).first()).toBeVisible();
  });
});
