<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, errorMessage } from '../api/http';
  import type { StoryFeedItem } from '../api/types';
  import { auth, fetchStoryPlayback, stories } from '../app';
  import { nextStory, previousStory, type StoryPosition } from '../stories/storyNavigation';
  import { createVideoUrls } from '../stories/videoUrls';
  import { formatWhen } from '../utils/format';

  interface Props {
    feed: StoryFeedItem[];
    startAuthor: number;
    onclose: () => void;
  }

  let { feed, startAuthor, onclose }: Props = $props();

  let position = $state<StoryPosition>(untrack(() => ({ author: startAuthor, story: 0 })));
  let videoUrl = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** The viewer asked to pause; a new story starts playing again. */
  let userPaused = $state(false);
  /** What the video is actually doing, from its own events: the browser may hold it back. */
  let playing = $state(false);
  let muted = $state(false);
  let progress = $state(0);
  /** The next story's link, for a hidden <video> that warms the cache while this one plays. */
  let nextUrl = $state<string | null>(null);
  /** Bumped by "Try again", or once by a failing video, to ask for the link once more. */
  let attempt = $state(0);
  /** The story whose link was already renewed after a failure: one silent retry each. */
  let renewedFor: string | null = null;
  let dialog = $state<HTMLDialogElement>();
  let video = $state<HTMLVideoElement>();

  const item = $derived(feed[position.author]);
  const story = $derived(item?.stories[position.story]);
  const own = $derived(item?.author.id === $auth.user?.id);

  const iconButton = 'grid size-9 place-items-center rounded-full hover:bg-white/10';
  /** Shared attributes of the control icons; the buttons carry the labels. */
  const icon = {
    class: 'size-5',
    viewBox: '0 0 24 24',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': true,
  } as const;

  // The link of the story on screen and of the next one are asked for ahead of time.
  const urls = createVideoUrls(fetchStoryPlayback);

  // A modal <dialog>: focus stays inside, Escape closes it, focus returns to the opener.
  $effect(() => {
    dialog?.showModal();
    // The dialog itself takes focus, not the first tap zone: keys work, nothing gets outlined.
    dialog?.focus();
  });

  // Load the story on screen and the one after it.
  $effect(() => {
    const current = story;
    void attempt;
    if (!current) return;
    videoUrl = null;
    error = null;
    progress = 0;
    userPaused = false;
    if (!current.seen) stories.markSeen(current.id);
    urls.get(current.id).then(
      (url) => {
        if (story?.id === current.id) videoUrl = url;
      },
      (cause: unknown) => {
        if (story?.id !== current.id) return;
        // Expired or deleted since the feed was loaded: move on.
        if (cause instanceof ApiError && cause.status === 404) goNext();
        else error = errorMessage(cause);
      },
    );
    const upcoming = nextStory(
      feed,
      untrack(() => position),
    );
    const upcomingStory = upcoming && feed[upcoming.author]?.stories[upcoming.story];
    nextUrl = null;
    if (upcomingStory) {
      urls.get(upcomingStory.id).then(
        (url) => {
          if (story?.id === current.id) nextUrl = url;
        },
        () => {},
      );
    }
  });

  // Progress from the recorder's duration: WebM from Chrome may report Infinity as its length.
  $effect(() => {
    let frame = requestAnimationFrame(function tick() {
      if (video && story) progress = Math.min((video.currentTime * 1000) / story.durationMs, 1);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  });

  function goNext() {
    const next = nextStory(feed, position);
    if (next) position = next;
    else dialog?.close();
  }

  function goPrevious() {
    const previous = previousStory(feed, position);
    if (previous) position = previous;
    else if (video) video.currentTime = 0;
  }

  async function play() {
    if (!video) return;
    try {
      await video.play();
    } catch (cause) {
      // The video starts after an async fetch, not right on the click, so the browser may
      // refuse sound. Muted playback is always allowed.
      if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
        muted = true;
        video.muted = true;
        await video.play().catch(() => {});
      }
    }
  }

  function togglePause() {
    if (!video) return;
    userPaused = playing;
    if (playing) video.pause();
    else void play();
  }

  async function remove() {
    if (!story || !confirm('Delete this story? This cannot be undone.')) return;
    try {
      await stories.remove(story.id);
      goNext();
    } catch (cause) {
      error = errorMessage(cause);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') goNext();
    else if (event.key === 'ArrowLeft') goPrevious();
    else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      togglePause();
    }
  }
</script>

{#if item && story}
  <dialog
    bind:this={dialog}
    {onclose}
    onkeydown={onKeydown}
    tabindex="-1"
    class="m-0 size-full max-h-none max-w-none items-center justify-center bg-black/90 p-0 outline-none open:flex sm:p-6"
    aria-label="Stories of {item.author.username}"
    data-testid="story-viewer"
  >
    <div
      class="relative aspect-[9/16] h-full max-h-dvh w-full max-w-md overflow-hidden bg-black sm:rounded-2xl"
    >
      {#if videoUrl}
        <video
          bind:this={video}
          src={videoUrl}
          class="size-full object-cover"
          playsinline
          {muted}
          onloadeddata={() => {
            if (!userPaused) void play();
          }}
          onplay={() => (playing = true)}
          onpause={() => (playing = false)}
          onerror={() => {
            playing = false;
            videoUrl = null;
            if (story && renewedFor !== story.id) {
              // The link may have expired meanwhile: ask for a new one, once, without a word.
              renewedFor = story.id;
              urls.forget(story.id);
              attempt += 1;
              return;
            }
            // Not a black screen: say so, and the arrows still move on.
            error = 'This video can’t be played in this browser.';
          }}
          onended={goNext}
          data-testid="story-video"
        ></video>
      {:else if error}
        <div
          class="flex size-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white"
        >
          <p>{error}</p>
          <button
            type="button"
            class="rounded-lg border border-white/40 px-3 py-1.5 hover:bg-white/10"
            onclick={() => {
              if (story) urls.forget(story.id);
              attempt += 1;
            }}>Try again</button
          >
        </div>
      {:else}
        <p class="flex size-full items-center justify-center text-sm text-white/70" role="status">
          Loading…
        </p>
      {/if}

      {#if nextUrl}
        <video src={nextUrl} preload="auto" muted class="hidden" aria-hidden="true"></video>
      {/if}

      <!-- Tap zones: the left third goes back, the rest goes forward. They are for the pointer
           and never take focus, not even on a click: the keyboard has the arrows, and a focused
           zone would get outlined on the next key and pressed by Space. -->
      <button
        type="button"
        tabindex="-1"
        class="absolute inset-y-0 left-0 w-1/3 outline-none"
        aria-label="Previous story"
        onmousedown={(event) => event.preventDefault()}
        onclick={goPrevious}
      ></button>
      <button
        type="button"
        tabindex="-1"
        class="absolute inset-y-0 right-0 w-2/3 outline-none"
        aria-label="Next story"
        onmousedown={(event) => event.preventDefault()}
        onclick={goNext}
      ></button>

      <div
        class="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-3 pb-10"
      >
        <div class="flex gap-1">
          {#each item.stories as s, i (s.id)}
            <div class="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                class="h-full bg-white"
                style:width="{i < position.story
                  ? 100
                  : i === position.story
                    ? progress * 100
                    : 0}%"
              ></div>
            </div>
          {/each}
        </div>
        <div class="mt-3 flex items-center gap-2 text-white">
          <span class="text-sm font-semibold">{own ? 'Your story' : item.author.username}</span>
          <span class="text-xs text-white/70">{formatWhen(story.createdAt)}</span>
        </div>
      </div>

      <div class="absolute top-10 right-2 flex items-center gap-1 text-white">
        {#if muted}
          <button
            type="button"
            class={iconButton}
            aria-label="Unmute"
            title="Unmute"
            onclick={() => {
              muted = false;
              if (video) video.muted = false;
            }}
          >
            <svg {...icon} fill="none" stroke="currentColor">
              <path d="M11 5 6 9H3v6h3l5 4z" />
              <path d="m16 9 5 6m0-6-5 6" />
            </svg>
          </button>
        {/if}
        <button
          type="button"
          class={iconButton}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
          onclick={togglePause}
        >
          {#if playing}
            <svg {...icon} fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          {:else}
            <svg {...icon} fill="currentColor"><path d="M7 4.5v15L19.5 12z" /></svg>
          {/if}
        </button>
        {#if own}
          <button
            type="button"
            class={iconButton}
            aria-label="Delete"
            title="Delete"
            onclick={remove}
          >
            <svg {...icon} fill="none" stroke="currentColor">
              <path
                d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
              />
            </svg>
          </button>
        {/if}
        <button
          type="button"
          class={iconButton}
          aria-label="Close"
          title="Close"
          onclick={() => dialog?.close()}
        >
          <svg {...icon} fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </div>
  </dialog>
{/if}
