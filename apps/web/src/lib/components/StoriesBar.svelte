<script lang="ts">
  import { resolve } from '$app/paths';
  import type { StoryFeedItem } from '../api/types';
  import { auth, stories } from '../app';

  interface Props {
    /** Opens the viewer on a snapshot of the feed, so new stories don't move what is playing. */
    onopen: (feed: StoryFeedItem[], author: number) => void;
  }

  let { onopen }: Props = $props();

  const feed = $derived($stories.feed);
  const mine = $derived(feed[0]?.author.id === $auth.user?.id ? feed[0] : undefined);
  const offset = $derived(mine ? 1 : 0);
  const others = $derived(feed.slice(offset));
</script>

<div class="flex gap-4 overflow-x-auto px-4 pt-4 pb-2" data-testid="stories-bar">
  <div class="flex w-16 shrink-0 flex-col items-center gap-1">
    <div class="relative">
      {#if mine}
        <button
          type="button"
          onclick={() => onopen(feed, 0)}
          class="flex size-14 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700 uppercase ring-2 ring-indigo-500 ring-offset-2 outline-none"
          aria-label="View your story">{$auth.user?.username.slice(0, 1)}</button
        >
      {:else}
        <span
          class="flex size-14 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-500 uppercase"
          aria-hidden="true">{$auth.user?.username.slice(0, 1)}</span
        >
      {/if}
      <a
        href={resolve('/(app)/stories/new')}
        class="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border-2 border-gray-50 bg-indigo-600 text-sm font-bold text-white"
        aria-label="Record a story"
        data-testid="new-story">+</a
      >
    </div>
    <span class="w-full truncate text-center text-xs text-gray-600">Your story</span>
  </div>

  {#each others as item, i (item.author.id)}
    <!-- No focus outline on the avatars: the viewer hands focus back here when it closes. -->
    <button
      type="button"
      class="flex w-16 shrink-0 flex-col items-center gap-1 outline-none"
      onclick={() => onopen(feed, i + offset)}
      data-testid="story-author"
    >
      <span
        class="flex size-14 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700 uppercase ring-2 ring-offset-2 {item.stories.some(
          (s) => !s.seen,
        )
          ? 'ring-indigo-500'
          : 'ring-gray-300'}"
        data-unseen={item.stories.some((s) => !s.seen)}
        aria-hidden="true">{item.author.username.slice(0, 1)}</span
      >
      <span class="w-full truncate text-center text-xs text-gray-700">{item.author.username}</span>
    </button>
  {/each}

  {#if $stories.status === 'ready' && others.length === 0}
    <p class="self-center text-xs text-gray-500">No stories from others yet</p>
  {/if}
</div>
