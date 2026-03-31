import { type Page, expect } from '@playwright/test';

export async function login(page: Page, username = 'admin', password = 'admin1') {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('/');
}

export async function ensureLoggedIn(page: Page) {
  await login(page);
  // Wait for sidebar to confirm app loaded
  await expect(page.locator('aside')).toBeVisible();
}

/** Get the auth token from localStorage after login */
export async function getAuthToken(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('beast_token') ?? '');
}

/** Make an authenticated API request via page.request */
export async function apiGet(page: Page, path: string) {
  const token = await getAuthToken(page);
  return page.request.get(path, {
    headers: { Authorization: `Token ${token}` },
  });
}

/** Make an authenticated API DELETE request */
export async function apiDelete(page: Page, path: string) {
  const token = await getAuthToken(page);
  return page.request.delete(path, {
    headers: { Authorization: `Token ${token}` },
  });
}
