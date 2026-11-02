import { expect, startChat, test } from '../support/fixtures.js';

test.describe('people', () => {
  test('search finds a user by part of the username, ignoring case', async ({ alice, bob }) => {
    const { page } = alice;
    await page.getByRole('link', { name: 'People' }).click();

    await page.getByLabel('Search by username').fill(bob.user.username.toUpperCase().slice(0, 8));
    await expect(page.getByTestId('user').filter({ hasText: bob.user.username })).toBeVisible();
    await expect(page.getByTestId('user').filter({ hasText: alice.user.username })).toHaveCount(0);
  });

  test('search says so when nobody matches', async ({ alice }) => {
    const { page } = alice;
    await page.getByRole('link', { name: 'People' }).click();
    await page.getByLabel('Search by username').fill('nobody_has_this_name');
    await expect(page.getByText('Nobody matches')).toBeVisible();
  });

  test('"Message" opens a conversation, listed afterwards', async ({ alice, bob }) => {
    const { page } = alice;
    await startChat(page, bob.user);

    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.getByTestId('conversation')).toContainText(bob.user.username);
  });
});
