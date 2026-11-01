/** A playback link for a story's video, and when it stops working (ms since the epoch). */
export interface PlaybackLink {
  url: string;
  expiresAt: number;
}

/**
 * Playback links, asked for once per story. The viewer asks for the story on screen and the next
 * one ahead of time; a link close to its expiry is asked for again, so a paused tab never
 * hands the <video> a link that is about to die.
 */
export interface VideoUrls {
  get(id: string): Promise<string>;
  /** Drops a failed or stale entry so the next get() asks again. */
  forget(id: string): void;
}

/** A link this close to its expiry is not worth handing out. */
const MARGIN_MS = 10_000;

export function createVideoUrls(
  fetchLink: (id: string) => Promise<PlaybackLink>,
  now: () => number = Date.now,
): VideoUrls {
  const cache = new Map<string, Promise<PlaybackLink>>();
  return {
    async get(id) {
      let entry = cache.get(id);
      if (entry) {
        const link = await entry.catch(() => null);
        if (link && link.expiresAt - MARGIN_MS > now()) return link.url;
        // Expired meanwhile, or failed: ask again (unless someone else already did).
        if (cache.get(id) === entry) cache.delete(id);
      }
      entry = cache.get(id);
      if (!entry) {
        entry = fetchLink(id);
        // A failure is not cached: "Try again" asks anew.
        entry.catch(() => {
          if (cache.get(id) === entry) cache.delete(id);
        });
        cache.set(id, entry);
      }
      return (await entry).url;
    },
    forget(id) {
      cache.delete(id);
    },
  };
}
