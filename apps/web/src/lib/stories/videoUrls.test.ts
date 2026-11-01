import { describe, expect, it, vi } from 'vitest';
import { createVideoUrls } from './videoUrls';

function setup() {
  let clock = 1_000_000;
  let n = 0;
  const fetchLink = vi.fn(async () => ({ url: `link:${++n}`, expiresAt: clock + 300_000 }));
  return {
    fetchLink,
    urls: createVideoUrls(fetchLink, () => clock),
    advance: (ms: number) => (clock += ms),
  };
}

describe('video URLs', () => {
  it('asks for each story once', async () => {
    const { urls, fetchLink } = setup();
    expect(await urls.get('a')).toBe('link:1');
    expect(await urls.get('a')).toBe('link:1');
    expect(fetchLink).toHaveBeenCalledOnce();
  });

  it('asks again after a failure', async () => {
    const { urls, fetchLink } = setup();
    fetchLink.mockRejectedValueOnce(new Error('offline'));
    await expect(urls.get('a')).rejects.toThrow('offline');
    expect(await urls.get('a')).toBe('link:1');
    expect(fetchLink).toHaveBeenCalledTimes(2);
  });

  it('asks again for a link that is about to expire, not for one that is fine', async () => {
    const { urls, advance } = setup();
    expect(await urls.get('a')).toBe('link:1');
    advance(200_000);
    expect(await urls.get('a')).toBe('link:1');
    advance(95_000);
    expect(await urls.get('a')).toBe('link:2');
  });

  it('asks again once forgotten', async () => {
    const { urls } = setup();
    await urls.get('a');
    urls.forget('a');
    expect(await urls.get('a')).toBe('link:2');
  });
});
