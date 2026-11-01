import { describe, expect, it } from 'vitest';
import { nextStory, previousStory } from './storyNavigation';

const feed = [{ stories: [1, 2] }, { stories: [] }, { stories: [3] }, { stories: [4, 5, 6] }];

describe('story navigation', () => {
  it('goes through an author’s stories, then on to the next author', () => {
    expect(nextStory(feed, { author: 0, story: 0 })).toEqual({ author: 0, story: 1 });
    expect(nextStory(feed, { author: 0, story: 1 })).toEqual({ author: 2, story: 0 });
    expect(nextStory(feed, { author: 2, story: 0 })).toEqual({ author: 3, story: 0 });
  });

  it('ends after the last story of the last author', () => {
    expect(nextStory(feed, { author: 3, story: 2 })).toBeNull();
  });

  it('goes back to the previous author’s last story', () => {
    expect(previousStory(feed, { author: 3, story: 1 })).toEqual({ author: 3, story: 0 });
    expect(previousStory(feed, { author: 3, story: 0 })).toEqual({ author: 2, story: 0 });
    expect(previousStory(feed, { author: 2, story: 0 })).toEqual({ author: 0, story: 1 });
  });

  it('stays put at the very first story', () => {
    expect(previousStory(feed, { author: 0, story: 0 })).toBeNull();
  });

  it('copes with a position outside the feed', () => {
    expect(nextStory(feed, { author: 9, story: 0 })).toBeNull();
    expect(nextStory([], { author: 0, story: 0 })).toBeNull();
  });
});
