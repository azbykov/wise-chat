import { expect, test } from '@playwright/test';
import { newUser, registerViaApi } from '../support/api.js';

test.describe('authentication', () => {
  test('a visitor creates an account and lands in the chats', async ({ page }) => {
    const user = newUser('new');
    await page.goto('/register');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByTestId('current-user')).toHaveText(user.username);
    await expect(page.getByText('No conversations yet.')).toBeVisible();
  });

  test('sign-up shows what is wrong with each field', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Username').fill('a');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/register$/);
    await expect(page.locator('#email-error')).toBeVisible();
    await expect(page.locator('#username-error')).toBeVisible();
    await expect(page.locator('#password-error')).toBeVisible();
  });

  test('a taken email is refused', async ({ page, request }) => {
    const user = newUser();
    await registerViaApi(request, user);

    await page.goto('/register');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Username').fill(`${user.username}_2`);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/register$/);
    await expect(page.locator('[id$="-error"], [role="alert"]').first()).toBeVisible();
  });

  test('a registered user signs in and out', async ({ page, request }) => {
    const user = newUser();
    await registerViaApi(request, user);

    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/chats$/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/chats');
    await expect(page).toHaveURL(/\/login\?next=%2Fchats$/);
  });

  test('a wrong password is refused with a message', async ({ page, request }) => {
    const user = newUser();
    await registerViaApi(request, user);

    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('private pages send a visitor to sign in and back afterwards', async ({ page, request }) => {
    const user = newUser();
    await registerViaApi(request, user);

    await page.goto('/users');
    await expect(page).toHaveURL(/\/login\?next=%2Fusers$/);

    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/users$/);
  });

  test('the session survives a reload', async ({ page, request }) => {
    const user = newUser();
    await registerViaApi(request, user);
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/chats$/);

    await page.reload();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByTestId('current-user')).toHaveText(user.username);
  });
});
