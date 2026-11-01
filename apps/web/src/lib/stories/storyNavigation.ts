/** Which story is on screen: the author's place in the feed and the story's place among theirs. */
export interface StoryPosition {
  author: number;
  story: number;
}

type Feed = ReadonlyArray<{ stories: ReadonlyArray<unknown> }>;

/** The next story: the author's next one, else the next author's first; null after the last. */
export function nextStory(feed: Feed, at: StoryPosition): StoryPosition | null {
  const author = feed[at.author];
  if (!author) return null;
  if (at.story < author.stories.length - 1) return { author: at.author, story: at.story + 1 };
  for (let next = at.author + 1; next < feed.length; next++) {
    if (feed[next]!.stories.length > 0) return { author: next, story: 0 };
  }
  return null;
}

/** The previous story: the author's previous one, else the previous author's last; null at the start. */
export function previousStory(feed: Feed, at: StoryPosition): StoryPosition | null {
  if (at.story > 0) return { author: at.author, story: at.story - 1 };
  for (let previous = at.author - 1; previous >= 0; previous--) {
    const count = feed[previous]!.stories.length;
    if (count > 0) return { author: previous, story: count - 1 };
  }
  return null;
}
