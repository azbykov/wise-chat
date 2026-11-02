import { expect, test } from '../support/fixtures.js';

test.describe('stories', () => {
  test('a recorded story shows up in the feed of another user, who can watch it', async ({
    alice,
    bob,
  }) => {
    const { page } = alice;
    await page.getByTestId('new-story').click();
    await expect(page).toHaveURL(/\/stories\/new$/);

    await page.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByText(/s left/)).toBeVisible();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop' }).click();

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByRole('button', { name: 'View your story' })).toBeVisible();

    await bob.page.reload();
    const author = bob.page.getByTestId('story-author').filter({ hasText: alice.user.username });
    await expect(author).toBeVisible();
    await author.click();

    const viewer = bob.page.getByTestId('story-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer.getByTestId('story-video')).toBeVisible();
    // Another user's story cannot be deleted.
    await expect(viewer.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(viewer).toHaveCount(0);
  });

  test('the author deletes their story', async ({ alice }) => {
    const { page } = alice;
    await page.goto('/stories/new');
    await page.getByRole('button', { name: 'Record' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page).toHaveURL(/\/chats$/);

    await page.getByRole('button', { name: 'View your story' }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).click();

    // The viewer moves on to the next author, if there is one: the feed is shared by everybody.
    const viewer = page.getByTestId('story-viewer');
    if (await viewer.isVisible()) await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(viewer).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View your story' })).toHaveCount(0);
  });

  test('retake discards the recording and returns to the camera', async ({ alice }) => {
    const { page } = alice;
    await page.goto('/stories/new');
    await page.getByRole('button', { name: 'Record' }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Retake' }).click();
    await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
  });
});
