<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { errorMessage } from '#lib/api/http.js';
  import { stories } from '#lib/app.js';
  import { cameraErrorMessage, MAX_STORY_MS, pickRecordingType } from '#lib/stories/recording.js';
  import { fixRecordedWebm } from '#lib/stories/recordedWebm.js';

  type Phase = 'starting' | 'ready' | 'recording' | 'recorded' | 'uploading' | 'error';

  let phase = $state<Phase>('starting');
  let error = $state<string | null>(null);
  let elapsed = $state(0);
  let live = $state<HTMLVideoElement>();
  let previewUrl = $state<string | null>(null);

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let recorded: { blob: Blob; durationMs: number } | null = null;
  let startedAt = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const mimeType = pickRecordingType();
  const secondsLeft = $derived(Math.max(0, Math.ceil((MAX_STORY_MS - elapsed) / 1000)));

  onMount(() => {
    void startCamera();
    // Leaving the page turns the camera off, whatever state the recorder is in.
    return () => {
      clearInterval(ticker);
      if (recorder?.state === 'recording') recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  });

  async function startCamera() {
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      fail('This browser cannot record video. Try a recent Chrome, Firefox or Safari.');
      return;
    }
    try {
      const video = { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } };
      // Sound is welcome but not required: a device without a microphone still records.
      stream = await navigator.mediaDevices
        .getUserMedia({ video, audio: true })
        .catch(() => navigator.mediaDevices.getUserMedia({ video, audio: false }));
      if (live) live.srcObject = stream;
      phase = 'ready';
    } catch (cause) {
      fail(cameraErrorMessage(cause));
    }
  }

  function fail(message: string) {
    error = message;
    phase = 'error';
  }

  function record() {
    if (!stream || !mimeType) return;
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => void finish(chunks);
    recorder.start(250);
    startedAt = performance.now();
    elapsed = 0;
    phase = 'recording';
    ticker = setInterval(() => {
      elapsed = performance.now() - startedAt;
      // Stops by itself at 15 seconds.
      if (elapsed >= MAX_STORY_MS) stop();
    }, 100);
  }

  function stop() {
    clearInterval(ticker);
    if (recorder?.state === 'recording') recorder.stop();
  }

  async function finish(chunks: Blob[]) {
    const durationMs = Math.min(Math.round(performance.now() - startedAt), MAX_STORY_MS);
    let blob = new Blob(chunks, { type: mimeType ?? 'video/webm' });
    // WebM comes without a duration, and from Firefox with audio Chrome can't seek in.
    if (blob.type.startsWith('video/webm')) {
      blob = await fixRecordedWebm(blob, durationMs);
    }
    recorded = { blob, durationMs };
    previewUrl = URL.createObjectURL(blob);
    phase = 'recorded';
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    recorded = null;
    elapsed = 0;
    phase = 'ready';
  }

  async function publish() {
    if (!recorded) return;
    phase = 'uploading';
    error = null;
    try {
      await stories.publish(recorded.blob, recorded.durationMs);
      await goto(resolve('/(app)/chats'));
    } catch (cause) {
      error = errorMessage(cause);
      phase = 'recorded';
    }
  }
</script>

<svelte:head><title>New story · Chat</title></svelte:head>

<section class="flex flex-1 flex-col items-center gap-4 px-4 py-4">
  <div class="flex w-full max-w-sm items-center justify-between">
    <a href={resolve('/(app)/chats')} class="text-sm text-gray-500 hover:text-gray-900">← Back</a>
    <h1 class="font-semibold">New story</h1>
    <span class="w-12"></span>
  </div>

  <div class="relative aspect-[9/16] w-full max-w-sm overflow-hidden rounded-2xl bg-black">
    {#if phase === 'recorded' || phase === 'uploading'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={previewUrl} class="size-full object-cover" playsinline autoplay loop controls
      ></video>
    {:else}
      <!-- The live camera, mirrored like a selfie; muted so it doesn't echo. -->
      <video
        bind:this={live}
        class="size-full -scale-x-100 object-cover"
        playsinline
        autoplay
        muted
        data-testid="camera"
      ></video>
    {/if}

    {#if phase === 'starting'}
      <p
        class="absolute inset-0 flex items-center justify-center text-sm text-white/80"
        role="status"
      >
        Starting the camera…
      </p>
    {:else if phase === 'error'}
      <div
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white"
      >
        <p role="alert">{error}</p>
        <button
          type="button"
          class="rounded-lg border border-white/40 px-3 py-1.5 hover:bg-white/10"
          onclick={() => {
            phase = 'starting';
            void startCamera();
          }}>Try again</button
        >
      </div>
    {:else if phase === 'recording'}
      <div class="absolute inset-x-0 top-0 p-3">
        <div class="h-1 overflow-hidden rounded-full bg-white/30">
          <div class="h-full bg-red-500" style:width="{(elapsed / MAX_STORY_MS) * 100}%"></div>
        </div>
        <p class="mt-2 text-center text-sm font-medium text-white" aria-live="polite">
          ● {secondsLeft}s left
        </p>
      </div>
    {/if}
  </div>

  {#if error && phase !== 'error'}
    <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  {/if}

  <div class="flex gap-3">
    {#if phase === 'ready'}
      <button
        type="button"
        onclick={record}
        class="rounded-full bg-red-600 px-6 py-3 text-sm font-medium text-white hover:bg-red-500"
        >Record</button
      >
    {:else if phase === 'recording'}
      <button
        type="button"
        onclick={stop}
        class="rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-700"
        >Stop</button
      >
    {:else if phase === 'recorded' || phase === 'uploading'}
      <button
        type="button"
        onclick={retake}
        disabled={phase === 'uploading'}
        class="rounded-full border border-gray-300 px-5 py-3 text-sm hover:bg-gray-50 disabled:opacity-60"
        >Retake</button
      >
      <button
        type="button"
        onclick={publish}
        disabled={phase === 'uploading'}
        class="rounded-full bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >{phase === 'uploading' ? 'Publishing…' : 'Publish'}</button
      >
    {/if}
  </div>
  <p class="text-xs text-gray-500">Up to 15 seconds. Stories disappear after 24 hours.</p>
</section>
