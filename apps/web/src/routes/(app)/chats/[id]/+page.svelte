<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import { errorMessage } from '#lib/api/http.js';
  import type { ConversationDto } from '#lib/api/types.js';
  import { auth, conversations, markRead, messages } from '#lib/app.js';
  import { contiguousSeq } from '#lib/stores/messages.js';
  import { formatTime } from '#lib/utils/format.js';

  const id = $derived(page.params.id!);
  const thread = $derived($messages[id]);
  const peer = $derived($conversations.items.find((c) => c.id === id)?.peer);

  let conversation = $state<ConversationDto | null>(null);
  let loadError = $state<string | null>(null);
  let draft = $state('');
  let list = $state<HTMLElement>();
  let stickToBottom = $state(true);
  let markedUpTo = 0;

  // A new conversation id (a link, another chat): load it from scratch.
  $effect(() => {
    const current = id;
    conversation = null;
    loadError = null;
    stickToBottom = true;
    markedUpTo = 0;
    conversations
      .ensure(current)
      .then((c) => {
        if (current === id) conversation = c;
      })
      .catch((cause: unknown) => {
        if (current === id) loadError = errorMessage(cause);
      });
    void messages.loadLatest(current);
  });

  // Keep the newest message in view, unless the user scrolled up to read older ones.
  $effect(() => {
    void thread?.items.length;
    if (stickToBottom) void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  function onScroll() {
    if (!list) return;
    stickToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  }

  // Read what the user can actually see: the tab is visible, the list is pinned to the bottom and
  // the numbers are continuous. A hole is not read past: its messages are still on the way.
  let visible = $state(typeof document === 'undefined' || document.visibilityState === 'visible');
  $effect(() => {
    const upTo = thread?.status === 'ready' ? contiguousSeq(thread) : 0;
    if (!conversation || !visible || !stickToBottom || upTo <= markedUpTo) return;
    const timer = setTimeout(() => {
      markedUpTo = upTo;
      markRead(id, upTo).catch(() => {
        markedUpTo = 0; // The next message or reconnect tries again.
      });
    }, 300);
    return () => clearTimeout(timer);
  });

  // Older messages go in above the viewport: keep what the user is reading where it was.
  async function loadEarlier() {
    if (!list) return;
    stickToBottom = false;
    const before = list.scrollHeight;
    await messages.loadOlder(id);
    await tick();
    if (list) list.scrollTop += list.scrollHeight - before;
  }

  async function send(event?: SubmitEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    draft = '';
    stickToBottom = true;
    await messages.send(id, text);
  }

  function onKeydown(event: KeyboardEvent) {
    // Enter sends, Shift+Enter starts a new line; keyboards composing a word keep their Enter.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  }
</script>

<svelte:document onvisibilitychange={() => (visible = document.visibilityState === 'visible')} />
<svelte:head><title>{peer?.username ?? 'Chat'} · Chat</title></svelte:head>

{#if loadError}
  <div class="px-4 py-10 text-center text-sm">
    <p class="text-red-700">{loadError}</p>
    <a href={resolve('/(app)/chats')} class="mt-3 inline-block text-indigo-600 hover:underline"
      >Back to chats</a
    >
  </div>
{:else}
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
      <a
        href={resolve('/(app)/chats')}
        class="text-sm text-gray-500 hover:text-gray-900"
        aria-label="Back">←</a
      >
      <h1 class="font-semibold" data-testid="peer">{peer?.username ?? '…'}</h1>
    </div>

    <div bind:this={list} onscroll={onScroll} class="flex-1 overflow-y-auto px-4 py-4">
      {#if !thread || thread.status === 'loading'}
        <p class="py-10 text-center text-sm text-gray-500" role="status">Loading messages…</p>
      {:else if thread.status === 'error'}
        <div class="py-10 text-center text-sm">
          <p class="text-red-700">{thread.error}</p>
          <button
            type="button"
            class="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
            onclick={() => messages.loadLatest(id)}>Try again</button
          >
        </div>
      {:else}
        {#if thread.hasMore}
          <div class="mb-3 text-center">
            <button
              type="button"
              class="text-sm text-indigo-600 hover:underline disabled:text-gray-400"
              disabled={thread.loadingOlder}
              onclick={loadEarlier}
              >{thread.loadingOlder ? 'Loading…' : 'Load earlier messages'}</button
            >
          </div>
        {/if}
        {#if thread.items.length === 0}
          <p class="py-10 text-center text-sm text-gray-500">Say hello to {peer?.username}!</p>
        {/if}
        <ol class="space-y-2" aria-live="polite">
          {#each thread.items as message (message.key)}
            {@const mine = message.senderId === $auth.user?.id}
            <li class={['flex', mine ? 'justify-end' : 'justify-start']} data-testid="message">
              <div
                class={[
                  'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                  message.status === 'failed'
                    ? 'bg-red-50 text-red-900 ring-1 ring-red-300'
                    : mine
                      ? 'bg-indigo-600 text-white'
                      : 'border border-gray-200 bg-white',
                  message.status === 'sending' && 'opacity-70',
                ]}
              >
                <p dir="auto" class="break-words whitespace-pre-wrap">{message.text}</p>
                <p
                  class={[
                    'mt-1 text-right text-[11px]',
                    mine && message.status !== 'failed' ? 'text-indigo-100' : 'text-gray-500',
                  ]}
                >
                  {#if message.status === 'sending'}
                    Sending…
                  {:else if message.status === 'failed'}
                    {message.error}
                    <button
                      type="button"
                      class="ml-1 font-medium underline"
                      onclick={() => messages.retry(id, message.key)}>Retry</button
                    >
                  {:else}
                    {formatTime(message.createdAt)}
                  {/if}
                </p>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </div>

    <form class="flex items-end gap-2 border-t border-gray-200 bg-white px-4 py-3" onsubmit={send}>
      <textarea
        bind:value={draft}
        onkeydown={onKeydown}
        rows="1"
        maxlength="2000"
        placeholder="Write a message"
        aria-label="Message"
        class="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      ></textarea>
      <button
        type="submit"
        disabled={!draft.trim() || thread?.status !== 'ready'}
        class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >Send</button
      >
    </form>
  </section>
{/if}
