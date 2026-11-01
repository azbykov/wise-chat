<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · Chat</title></svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4">
  <div class="max-w-sm text-center">
    <p class="text-sm font-medium text-gray-500">{page.status}</p>
    <h1 class="mt-1 text-lg font-semibold">{page.error?.message ?? 'Something went wrong'}</h1>
    <div class="mt-6 flex justify-center gap-3 text-sm">
      <button
        type="button"
        class="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
        onclick={() => location.reload()}>Try again</button
      >
      <a
        href={resolve('/(app)/chats')}
        class="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50">Go to chats</a
      >
    </div>
  </div>
</main>
