import { request } from '@playwright/test';
import { newUser, registerViaApi } from '../support/api.js';
import { expect, startChat, test } from '../support/fixtures.js';

test.describe('chat', () => {
  test('a message reaches the other user in real time, and the reply comes back', async ({
    alice,
    bob,
  }) => {
    await startChat(alice.page, bob.user);

    // Bob is on the chat list when the message comes in.
    await expect(bob.page.getByText('No conversations yet.')).toBeVisible();

    await alice.page.getByLabel('Message').fill('Hello Bob');
    await alice.page.getByLabel('Message').press('Enter');
    await expect(alice.page.getByTestId('message')).toHaveText(/Hello Bob/);

    const row = bob.page.getByTestId('conversation').filter({ hasText: alice.user.username });
    await expect(row).toContainText('Hello Bob');
    await expect(row.getByTestId('unread')).toHaveText('1');

    await row.click();
    await expect(bob.page.getByTestId('message')).toHaveText(/Hello Bob/);

    await bob.page.getByLabel('Message').fill('Hi Alice');
    await bob.page.getByRole('button', { name: 'Send' }).click();
    await expect(alice.page.getByTestId('message').last()).toContainText('Hi Alice');
  });

  test('reading a conversation clears its unread counter', async ({ alice, bob }) => {
    await startChat(alice.page, bob.user);
    for (const text of ['one', 'two', 'three']) {
      await alice.page.getByLabel('Message').fill(text);
      await alice.page.getByLabel('Message').press('Enter');
    }
    await expect(alice.page.getByTestId('message')).toHaveCount(3);

    const row = bob.page.getByTestId('conversation').filter({ hasText: alice.user.username });
    await expect(row.getByTestId('unread')).toHaveText('3');

    await row.click();
    await expect(bob.page.getByTestId('message')).toHaveCount(3);
    // The chat is marked as read shortly after it is shown; the header badge follows.
    await expect(bob.page.getByLabel('3 unread')).toHaveCount(0);
    await bob.page.getByRole('link', { name: 'Back' }).click();
    await expect(
      bob.page.getByTestId('conversation').filter({ hasText: alice.user.username }),
    ).toBeVisible();
    await expect(bob.page.getByTestId('unread')).toHaveCount(0);
  });

  test('history survives a reload, in order', async ({ alice, bob }) => {
    await startChat(alice.page, bob.user);
    const texts = ['first', 'second', 'third'];
    for (const text of texts) {
      await alice.page.getByLabel('Message').fill(text);
      await alice.page.getByLabel('Message').press('Enter');
      const sent = alice.page.getByTestId('message').last();
      await expect(sent).toContainText(text);
      // Shown at once, saved a moment later: reload only after the server has it.
      await expect(sent).not.toContainText('Sending');
    }

    await alice.page.reload();
    await expect(alice.page.getByTestId('message')).toHaveText([/first/, /second/, /third/]);
  });

  test('Shift+Enter adds a line, an empty message is not sent', async ({ alice, bob }) => {
    await startChat(alice.page, bob.user);
    const field = alice.page.getByLabel('Message');
    const send = alice.page.getByRole('button', { name: 'Send' });

    await field.fill('   ');
    await expect(send).toBeDisabled();

    await field.fill('line one');
    await field.press('Shift+Enter');
    await field.pressSequentially('line two');
    await field.press('Enter');

    await expect(alice.page.getByTestId('message')).toHaveCount(1);
    await expect(alice.page.getByTestId('message')).toContainText('line one');
    await expect(alice.page.getByTestId('message')).toContainText('line two');
  });

  test('opening a conversation of two other users is refused', async ({ alice, bob, browser }) => {
    await startChat(alice.page, bob.user);
    const url = alice.page.url();

    const context = await browser.newContext();
    const mallory = newUser('mallory');
    // Registered apart from the browser: its refresh cookie would skip the sign-in page.
    const api = await request.newContext();
    await registerViaApi(api, mallory);
    await api.dispose();
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(mallory.email);
    await page.getByLabel('Password').fill(mallory.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/chats$/);

    await page.goto(url);
    await expect(page.getByRole('link', { name: 'Back to chats' })).toBeVisible();
    await expect(page.getByLabel('Message')).toHaveCount(0);
    await context.close();
  });
});
