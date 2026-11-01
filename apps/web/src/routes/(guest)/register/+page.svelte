<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import TextField from '#lib/components/TextField.svelte';
  import { ApiError, errorMessage } from '#lib/api/http.js';
  import { auth } from '#lib/app.js';
  import { safeNext } from '#lib/utils/redirect.js';

  let email = $state('');
  let username = $state('');
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
      await auth.register({ email, username, password });
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

<svelte:head><title>Create account · Chat</title></svelte:head>

<h1 class="text-xl font-semibold">Create account</h1>

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
    label="Username"
    name="username"
    autocomplete="username"
    required
    minlength={3}
    maxlength={24}
    bind:value={username}
    error={fieldErrors.username}
  />
  <p class="-mt-2 text-xs text-gray-500">3–24 characters: letters, digits, “_” and “.”</p>
  <TextField
    label="Password"
    name="password"
    type="password"
    autocomplete="new-password"
    required
    minlength={8}
    bind:value={password}
    error={fieldErrors.password}
  />
  <p class="-mt-2 text-xs text-gray-500">At least 8 characters</p>

  {#if error}
    <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  {/if}

  <button
    type="submit"
    disabled={submitting}
    class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
  >
    {submitting ? 'Creating account…' : 'Create account'}
  </button>
</form>

<p class="mt-6 text-center text-sm text-gray-600">
  Already have an account?
  <a
    href={page.url.searchParams.size
      ? resolve(`/(guest)/login?${page.url.searchParams}`)
      : resolve('/(guest)/login')}
    class="font-medium text-indigo-600 hover:underline">Sign in</a
  >
</p>
