import { type Page, expect } from '@playwright/test';

export async function login(page: Page, username = 'admin', password = 'admin1') {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/onboarding');

  if (page.url().includes('/onboarding')) {
    await completeOnboarding(page);
  }
}

async function completeOnboarding(page: Page) {
  const nameInput = page.getByPlaceholder('e.g. My Company');
  await nameInput.fill('E2E Test');
  await page.getByRole('button', { name: /create workspace/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/onboarding'), { timeout: 15000 });
}

export async function ensureLoggedIn(page: Page) {
  await login(page);
  await expect(page.locator('aside')).toBeVisible({ timeout: 10000 });
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

/** Make an authenticated API POST request */
export async function apiPost(page: Page, path: string, data: unknown) {
  const token = await getAuthToken(page);
  return page.request.post(path, {
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    data,
  });
}

/** Make an authenticated API DELETE request */
export async function apiDelete(page: Page, path: string) {
  const token = await getAuthToken(page);
  return page.request.delete(path, {
    headers: { Authorization: `Token ${token}` },
  });
}
