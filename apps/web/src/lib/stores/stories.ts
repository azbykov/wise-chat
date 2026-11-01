import { writable, type Readable } from 'svelte/store';
import { errorMessage } from '../api/http';
import type { StoryCreatedEvent, StoryDeletedEvent, StoryDto, StoryFeedItem } from '../api/types';

export interface StoriesState {
  feed: StoryFeedItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

export interface StoriesTransport {
  feed(): Promise<StoryFeedItem[]>;
  upload(video: Blob, durationMs: number): Promise<StoryDto>;
  remove(id: string): Promise<void>;
  markSeen(id: string): Promise<void>;
}

export interface StoriesStore extends Readable<StoriesState> {
  /**
   * (Re)loads the feed; a reload keeps what is shown until the new feed arrives, and what
   * the socket delivered meanwhile survives it.
   */
  load(): Promise<void>;
  publish(video: Blob, durationMs: number): Promise<StoryDto>;
  remove(id: string): Promise<void>;
  /** Marks the story seen at once and tells the server; a failed request is not worth a retry. */
  markSeen(id: string): void;
  /** A `story:created` event: adds the story to the feed in place. */
  receive(event: StoryCreatedEvent, viewerId: string): void;
  /** A `story:deleted` event: drops the story, and its author if it was the last one. */
  drop(event: StoryDeletedEvent): void;
  reset(): void;
}

type Change = (feed: StoryFeedItem[]) => StoryFeedItem[];

const INITIAL: StoriesState = { feed: [], status: 'idle', error: null };

export function createStoriesStore(transport: StoriesTransport): StoriesStore {
  const state = writable<StoriesState>(INITIAL);
  let loading: Promise<void> | null = null;
  // Changes made while the feed is in flight: the snapshot may predate them, so they are
  // applied again on top of it.
  let missed: Change[] | null = null;

  function apply(change: Change) {
    missed?.push(change);
    state.update((s) => ({ ...s, feed: change(s.feed) }));
  }

  async function load() {
    // Several story events in a row need one reload, not one each.
    loading ??= (async () => {
      const changes: Change[] = [];
      missed = changes;
      state.update((s) => ({ ...s, status: s.feed.length ? s.status : 'loading', error: null }));
      try {
        const snapshot = await transport.feed();
        const feed = changes.reduce((feed, change) => change(feed), snapshot);
        state.set({ feed, status: 'ready', error: null });
      } catch (error) {
        state.update((s) => ({ ...s, status: 'error', error: errorMessage(error) }));
      }
    })().finally(() => {
      loading = null;
      missed = null;
    });
    return loading;
  }

  /** The viewer first, then the others by their newest story, as the server orders them. */
  function sorted(feed: StoryFeedItem[], viewerId?: string): StoryFeedItem[] {
    const newest = (i: StoryFeedItem) => i.stories[i.stories.length - 1]!.createdAt;
    return [...feed].sort(
      (a, b) =>
        Number(b.author.id === viewerId) - Number(a.author.id === viewerId) ||
        newest(b).localeCompare(newest(a)),
    );
  }

  return {
    subscribe: state.subscribe,
    load,
    async publish(video, durationMs) {
      const story = await transport.upload(video, durationMs);
      await load();
      return story;
    },
    async remove(id) {
      await transport.remove(id);
      await load();
    },
    markSeen(id) {
      apply((feed) =>
        feed.map((item) => ({
          ...item,
          stories: item.stories.map((story) =>
            story.id === id ? { ...story, seen: true } : story,
          ),
        })),
      );
      transport.markSeen(id).catch(() => {});
    },
    receive({ story, author }, viewerId) {
      apply((feed) => {
        const mine = author.id === viewerId;
        const incoming = { ...story, seen: mine };
        const known = feed.find((item) => item.author.id === author.id);
        if (known?.stories.some((x) => x.id === story.id)) return feed;
        const next = known
          ? feed.map((item) =>
              item === known ? { ...item, stories: [...item.stories, incoming] } : item,
            )
          : [...feed, { author, stories: [incoming] }];
        return sorted(next, viewerId);
      });
    },
    drop({ storyId, authorId }) {
      apply((feed) =>
        feed
          .map((item) =>
            item.author.id === authorId
              ? { ...item, stories: item.stories.filter((x) => x.id !== storyId) }
              : item,
          )
          .filter((item) => item.stories.length > 0),
      );
    },
    reset() {
      state.set(INITIAL);
    },
  };
}
