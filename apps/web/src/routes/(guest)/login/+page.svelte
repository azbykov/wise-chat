<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import TextField from '#lib/components/TextField.svelte';
  import { ApiError, errorMessage } from '#lib/api/http.js';
  import { auth } from '#lib/app.js';
  import { safeNext } from '#lib/utils/redirect.js';

  let email = $state('');
  let password = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let fieldErrors = $state<Record<string, string>>({});

  const next = $derived(page.url.searchParams.get('next'));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    submitting = true;
    error = null;
    fieldErrors = {};
    try {
      await auth.login({ email, password });
      // safeNext returns a path inside this app, and the app has no base path to add.
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      await goto(safeNext(next, page.url.origin));
    } catch (cause) {
      fieldErrors = cause instanceof ApiError ? cause.fieldErrors() : {};
      error = Object.keys(fieldErrors).length ? null : errorMessage(cause);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Sign in · Chat</title></svelte:head>

<h1 class="text-xl font-semibold">Sign in</h1>

<form class="mt-6 space-y-4" onsubmit={submit} novalidate>
  <TextField
    label="Email"
    name="email"
    type="email"
    autocomplete="email"
    required
    bind:value={email}
    error={fieldErrors.email}
  />
  <TextField
    label="Password"
    name="password"
    type="password"
    autocomplete="current-password"
    required
    bind:value={password}
    error={fieldErrors.password}
  />

  {#if error}
    <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  {/if}

  <button
    type="submit"
    disabled={submitting}
    class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
  >
    {submitting ? 'Signing in…' : 'Sign in'}
  </button>
</form>

<p class="mt-6 text-center text-sm text-gray-600">
  No account yet?
  <a
    href={page.url.searchParams.size
      ? resolve(`/(guest)/register?${page.url.searchParams}`)
      : resolve('/(guest)/register')}
    class="font-medium text-indigo-600 hover:underline">Create one</a
  >
</p>
