<script lang="ts">
  import { resolve } from '$app/paths';
  import type { StoryFeedItem } from '#lib/api/types.js';
  import { auth, conversations, stories } from '#lib/app.js';
  import StoriesBar from '#lib/components/StoriesBar.svelte';
  import StoryViewer from '#lib/components/StoryViewer.svelte';
  import { formatWhen } from '#lib/utils/format.js';

  // The socket reloads the list on every connect; this covers opening the page before that.
  $effect(() => {
    if ($conversations.status === 'idle') void conversations.load();
    if ($stories.status === 'idle') void stories.load();
  });

  let viewing = $state<{ feed: StoryFeedItem[]; startAuthor: number } | null>(null);
</script>

<svelte:head><title>Chats · Chat</title></svelte:head>

<StoriesBar onopen={(feed, startAuthor) => (viewing = { feed, startAuthor })} />

{#if viewing}
  <StoryViewer {...viewing} onclose={() => (viewing = null)} />
{/if}

<section class="flex-1 px-4 py-4">
  {#if $conversations.status === 'loading' || $conversations.status === 'idle'}
    <p class="py-10 text-center text-sm text-gray-500" role="status">Loading conversations…</p>
  {:else if $conversations.status === 'error' && $conversations.items.length === 0}
    <div class="py-10 text-center text-sm">
      <p class="text-red-700">{$conversations.error}</p>
      <button
        type="button"
        class="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
        onclick={() => conversations.load()}>Try again</button
      >
    </div>
  {:else if $conversations.items.length === 0}
    <div class="py-10 text-center text-sm text-gray-600">
      <p>No conversations yet.</p>
      <a
        href={resolve('/(app)/users')}
        class="mt-2 inline-block font-medium text-indigo-600 hover:underline"
        >Find someone to talk to</a
      >
    </div>
  {:else}
    <ul class="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
      {#each $conversations.items as conversation (conversation.id)}
        {@const last = conversation.lastMessage}
        <li>
          <a
            href={resolve('/(app)/chats/[id]', { id: conversation.id })}
            class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
            data-testid="conversation"
          >
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700 uppercase"
              aria-hidden="true">{conversation.peer.username.slice(0, 1)}</span
            >
            <span class="min-w-0 flex-1">
              <span class="flex items-baseline justify-between gap-2">
                <span class="truncate font-medium">{conversation.peer.username}</span>
                <span class="shrink-0 text-xs text-gray-500"
                  >{formatWhen(conversation.lastMessageAt)}</span
                >
              </span>
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-sm text-gray-600">
                  {#if last}
                    {last.senderId === $auth.user?.id ? 'You: ' : ''}{last.text}
                  {:else}
                    <span class="italic text-gray-500">No messages yet</span>
                  {/if}
                </span>
                {#if conversation.unreadCount > 0}
                  <span
                    class="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white"
                    data-testid="unread"
                    aria-label="{conversation.unreadCount} unread">{conversation.unreadCount}</span
                  >
                {/if}
              </span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
