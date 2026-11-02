import { expect, test } from '@playwright/test';
import { API_URL, newUser, registerViaApi } from '../support/api.js';

test.describe('API', () => {
  test('health reports the API and MongoDB as up', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', mongo: 'up' });
  });

  test('private endpoints refuse a request without a token', async ({ request }) => {
    for (const path of ['/auth/me', '/users', '/conversations', '/stories/feed']) {
      const response = await request.get(`${API_URL}${path}`);
      expect(response.status(), path).toBe(401);
    }
  });

  test('sign-up validates input and refuses a duplicate email', async ({ request }) => {
    const invalid = await request.post(`${API_URL}/auth/register`, {
      data: { email: 'not-an-email', username: 'x', password: 'short' },
    });
    expect(invalid.status()).toBe(400);

    const user = newUser();
    await registerViaApi(request, user);
    const duplicate = await request.post(`${API_URL}/auth/register`, {
      data: { ...user, username: `${user.username}_2` },
    });
    expect(duplicate.status()).toBe(409);
  });

  test('the web app serves the sign-in page', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Sign in/);
  });
});
