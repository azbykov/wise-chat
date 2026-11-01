<script lang="ts">
  let { children } = $props();
</script>

<main class="flex min-h-dvh items-center justify-center px-4 py-10">
  <div class="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
    {@render children()}
  </div>
</main>
