import { test as base, expect, request, type Browser, type Page } from '@playwright/test';
import { newUser, registerViaApi, type TestUser } from './api.js';

export interface Session {
  user: TestUser;
  page: Page;
}

/** A new user, registered through the API and signed in on a page of an isolated browser context. */
async function openSession(browser: Browser, prefix: string): Promise<Session> {
  const context = await browser.newContext();
  const user = newUser(prefix);
  // Its own request context: registering sets the refresh cookie, and a browser holding it would
  // skip the sign-in page, which is what these tests walk through.
  const api = await request.newContext();
  await registerViaApi(api, user);
  await api.dispose();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/chats$/);
  return { user, page };
}

export const test = base.extend<{ alice: Session; bob: Session }>({
  alice: async ({ browser }, use) => {
    const session = await openSession(browser, 'alice');
    await use(session);
    await session.page.context().close();
  },
  bob: async ({ browser }, use) => {
    const session = await openSession(browser, 'bob');
    await use(session);
    await session.page.context().close();
  },
});

export { expect };

/** Opens a conversation with `peer` from the People page. */
export async function startChat(page: Page, peer: TestUser) {
  await page.getByRole('link', { name: 'People' }).click();
  await page.getByLabel('Search by username').fill(peer.username);
  const row = page.getByTestId('user').filter({ hasText: peer.username });
  await row.getByRole('button', { name: 'Message' }).click();
  await expect(page).toHaveURL(/\/chats\/[0-9a-f]{24}$/);
  await expect(page.getByTestId('peer')).toHaveText(peer.username);
}
