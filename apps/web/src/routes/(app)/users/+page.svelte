<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { errorMessage } from '#lib/api/http.js';
  import type { Page, UserDto } from '#lib/api/types.js';
  import { auth, conversations, http } from '#lib/app.js';

  let search = $state('');
  let items = $state<UserDto[]>([]);
  let nextCursor = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state<string | null>(null);
  let loadingMore = $state(false);
  let opening = $state<string | null>(null);
  let request = 0;

  function fetchPage(cursor?: string) {
    return http<Page<UserDto>>('/users', {
      token: auth.token(),
      query: { search: search.trim(), cursor, limit: 20 },
    });
  }

  // Searches 300 ms after the last keystroke; a slower, older answer never overwrites a newer one.
  $effect(() => {
    void search;
    const current = ++request;
    status = 'loading';
    const timer = setTimeout(() => {
      fetchPage()
        .then((result) => {
          if (current !== request) return;
          items = result.items;
          nextCursor = result.nextCursor;
          status = 'ready';
        })
        .catch((cause: unknown) => {
          if (current !== request) return;
          error = errorMessage(cause);
          status = 'error';
        });
    }, 300);
    return () => clearTimeout(timer);
  });

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    loadingMore = true;
    const current = request;
    try {
      const result = await fetchPage(nextCursor);
      if (current !== request) return;
      items = [...items, ...result.items];
      nextCursor = result.nextCursor;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loadingMore = false;
    }
  }

  async function message(user: UserDto) {
    opening = user.id;
    try {
      const conversation = await conversations.open(user.id);
      await goto(resolve('/(app)/chats/[id]', { id: conversation.id }));
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      opening = null;
    }
  }
</script>

<svelte:head><title>People · Chat</title></svelte:head>

<section class="flex-1 px-4 py-4">
  <input
    type="search"
    bind:value={search}
    maxlength="24"
    placeholder="Search by username"
    aria-label="Search by username"
    class="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
  />

  {#if error && status !== 'error'}
    <p role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  {/if}

  {#if status === 'loading'}
    <p class="py-10 text-center text-sm text-gray-500" role="status">Loading people…</p>
  {:else if status === 'error'}
    <p class="py-10 text-center text-sm text-red-700">{error}</p>
  {:else if items.length === 0}
    <p class="py-10 text-center text-sm text-gray-500">
      {search.trim() ? `Nobody matches “${search.trim()}”.` : 'Nobody else is here yet.'}
    </p>
  {:else}
    <ul
      class="mt-4 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      {#each items as user (user.id)}
        <li class="flex items-center gap-3 px-4 py-3" data-testid="user">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-100 font-semibold text-gray-700 uppercase"
            aria-hidden="true">{user.username.slice(0, 1)}</span
          >
          <span class="flex-1 truncate font-medium">{user.username}</span>
          <button
            type="button"
            disabled={opening !== null}
            onclick={() => message(user)}
            class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >{opening === user.id ? 'Opening…' : 'Message'}</button
          >
        </li>
      {/each}
    </ul>
    {#if nextCursor}
      <div class="mt-4 text-center">
        <button
          type="button"
          disabled={loadingMore}
          onclick={loadMore}
          class="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
          >{loadingMore ? 'Loading…' : 'Show more'}</button
        >
      </div>
    {/if}
  {/if}
</section>
