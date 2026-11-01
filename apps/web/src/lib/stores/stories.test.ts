import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import type { StoryFeedItem } from '../api/types';
import { pickRecordingType } from '../stories/recording';
import { createStoriesStore } from './stories';

const item = (username: string): StoryFeedItem => ({
  author: { id: username, username, createdAt: '2026-01-01T00:00:00Z' },
  stories: [],
});

const story = (id: string, authorId: string, createdAt = '2026-01-01T00:00:00Z') => ({
  id,
  authorId,
  mimeType: 'video/webm',
  durationMs: 3000,
  sizeBytes: 1,
  createdAt,
  expiresAt: '2026-01-02T00:00:00Z',
  seen: false,
});

describe('stories store', () => {
  it('loads the feed', async () => {
    const store = createStoriesStore({
      feed: async () => [item('alice')],
      upload: vi.fn(),
      remove: vi.fn(),
      markSeen: vi.fn(async () => {}),
    });
    await store.load();
    expect(get(store)).toMatchObject({
      status: 'ready',
      feed: [{ author: { username: 'alice' } }],
    });
  });

  it('asks once when several events want a reload at the same time', async () => {
    const feed = vi.fn(async () => [item('alice')]);
    const store = createStoriesStore({
      feed,
      upload: vi.fn(),
      remove: vi.fn(),
      markSeen: vi.fn(async () => {}),
    });
    await Promise.all([store.load(), store.load(), store.load()]);
    expect(feed).toHaveBeenCalledOnce();
  });

  it('reloads the feed after publishing and after deleting', async () => {
    const feed = vi.fn(async () => []);
    const upload = vi.fn(async () => ({ id: 's1' }) as never);
    const remove = vi.fn(async () => {});
    const store = createStoriesStore({ feed, upload, remove, markSeen: vi.fn(async () => {}) });

    await store.publish(new Blob(['v']), 3000);
    await store.remove('s1');
    expect(upload).toHaveBeenCalledWith(expect.any(Blob), 3000);
    expect(remove).toHaveBeenCalledWith('s1');
    expect(feed).toHaveBeenCalledTimes(2);
  });

  it('keeps the shown feed when a reload fails', async () => {
    let fail = false;
    const store = createStoriesStore({
      feed: async () => {
        if (fail) throw new Error('down');
        return [item('alice')];
      },
      upload: vi.fn(),
      remove: vi.fn(),
      markSeen: vi.fn(async () => {}),
    });
    await store.load();
    fail = true;
    await store.load();
    expect(get(store).feed).toHaveLength(1);
    expect(get(store).status).toBe('error');
  });
});

describe('pickRecordingType', () => {
  it('prefers H.264 in MP4, which every browser plays', () => {
    expect(pickRecordingType(() => true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    expect(pickRecordingType((type) => type === 'video/mp4')).toBe('video/mp4');
  });

  it('falls back to WebM in Firefox, which records nothing else', () => {
    expect(pickRecordingType((type) => type.startsWith('video/webm'))).toBe(
      'video/webm;codecs=vp9,opus',
    );
  });

  it('reports a browser that cannot record', () => {
    expect(pickRecordingType(() => false)).toBeNull();
  });

  describe('events and views', () => {
    const idle = () =>
      createStoriesStore({
        feed: async () => [],
        upload: vi.fn(),
        remove: vi.fn(),
        markSeen: vi.fn(async () => {}),
      });
    const author = (id: string) => ({ id, username: id, createdAt: '2026-01-01T00:00:00Z' });

    it('adds a created story without asking for the feed, the viewer first', () => {
      const store = idle();
      store.receive({ story: story('s1', 'bob'), author: author('bob') }, 'me');
      store.receive({ story: story('s2', 'me'), author: author('me') }, 'me');
      store.receive({ story: story('s1', 'bob'), author: author('bob') }, 'me');
      const feed = get(store).feed;
      expect(feed.map((i) => i.author.id)).toEqual(['me', 'bob']);
      expect(feed[1]!.stories).toHaveLength(1);
      expect(feed[0]!.stories[0]!.seen).toBe(true);
      expect(feed[1]!.stories[0]!.seen).toBe(false);
    });

    it('drops a deleted story and its author after the last one', () => {
      const store = idle();
      store.receive({ story: story('s1', 'bob'), author: author('bob') }, 'me');
      store.receive(
        { story: story('s2', 'bob', '2026-01-01T01:00:00Z'), author: author('bob') },
        'me',
      );
      store.drop({ storyId: 's1', authorId: 'bob' });
      expect(get(store).feed[0]!.stories.map((s) => s.id)).toEqual(['s2']);
      store.drop({ storyId: 's2', authorId: 'bob' });
      expect(get(store).feed).toEqual([]);
    });

    it('keeps what the socket delivered while the feed was in flight', async () => {
      let answer!: (feed: StoryFeedItem[]) => void;
      const store = createStoriesStore({
        feed: () => new Promise((resolve) => (answer = resolve)),
        upload: vi.fn(),
        remove: vi.fn(),
        markSeen: vi.fn(async () => {}),
      });
      const loading = store.load();
      store.receive(
        { story: story('s3', 'carol', '2026-01-01T02:00:00Z'), author: author('carol') },
        'me',
      );
      store.drop({ storyId: 's1', authorId: 'bob' });
      store.markSeen('s2');
      answer([
        { author: author('bob'), stories: [story('s1', 'bob')] },
        { author: author('dave'), stories: [story('s2', 'dave', '2026-01-01T01:00:00Z')] },
      ]);
      await loading;

      const feed = get(store).feed;
      expect(feed.map((i) => i.author.id)).toEqual(['carol', 'dave']);
      expect(feed[1]!.stories[0]!.seen).toBe(true);
    });

    it('marks a story seen at once and reports it to the server', () => {
      const markSeen = vi.fn(async () => {});
      const store = createStoriesStore({
        feed: async () => [],
        upload: vi.fn(),
        remove: vi.fn(),
        markSeen,
      });
      store.receive({ story: story('s1', 'bob'), author: author('bob') }, 'me');
      store.markSeen('s1');
      expect(get(store).feed[0]!.stories[0]!.seen).toBe(true);
      expect(markSeen).toHaveBeenCalledWith('s1');
    });
  });
});
