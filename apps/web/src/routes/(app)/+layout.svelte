<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { derived } from 'svelte/store';
  import { auth, conversations, signOut, socket, startRealtime } from '#lib/app.js';

  let { children } = $props();

  const status = socket.status;
  const totalUnread = derived(conversations, ($c) =>
    $c.items.reduce((sum, c) => sum + c.unreadCount, 0),
  );

  onMount(() => startRealtime());

  const linkClass = 'rounded-md px-3 py-1.5 text-sm font-medium';
  const active = 'bg-indigo-50 text-indigo-700';
  const idle = 'text-gray-600 hover:bg-gray-100';
</script>

<div class="flex h-dvh flex-col">
  <header class="border-b border-gray-200 bg-white">
    <div class="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
      <span class="font-semibold text-indigo-600">Chat</span>
      <nav class="flex gap-1">
        <a
          href={resolve('/(app)/chats')}
          class={[linkClass, page.url.pathname.startsWith('/chats') ? active : idle]}
        >
          Chats
          {#if $totalUnread > 0}
            <span
              class="ml-1 rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs text-white"
              aria-label="{$totalUnread} unread">{$totalUnread}</span
            >
          {/if}
        </a>
        <a
          href={resolve('/(app)/users')}
          class={[linkClass, page.url.pathname.startsWith('/users') ? active : idle]}>People</a
        >
      </nav>
      <div class="ml-auto flex items-center gap-3 text-sm">
        <span class="hidden text-gray-600 sm:inline" data-testid="current-user"
          >{$auth.user?.username}</span
        >
        <button type="button" class="text-gray-500 hover:text-gray-900" onclick={signOut}>
          Sign out
        </button>
      </div>
    </div>
    {#if $status === 'offline'}
      <div role="status" class="bg-amber-50 px-4 py-1.5 text-center text-sm text-amber-800">
        Connection lost. Reconnecting…
      </div>
    {/if}
  </header>

  <!-- The header takes what it needs (with the offline banner too); pages get the rest. -->
  <div class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto">
    {@render children()}
  </div>
</div>
