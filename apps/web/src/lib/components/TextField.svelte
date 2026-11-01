<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    label: string;
    name: string;
    value: string;
    error?: string;
  }

  let { label, name, value = $bindable(), error, ...rest }: Props = $props();
</script>

<label class="block">
  <span class="text-sm font-medium text-gray-700">{label}</span>
  <input
    {name}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? `${name}-error` : undefined}
    class={[
      'mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2',
      error
        ? 'border-red-400 focus:ring-red-200'
        : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-200',
    ]}
    {...rest}
  />
  {#if error}
    <span id="{name}-error" class="mt-1 block text-xs text-red-600">{error}</span>
  {/if}
</label>
