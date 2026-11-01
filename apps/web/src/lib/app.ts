import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { PUBLIC_API_URL } from '$app/env/public';
import { get } from 'svelte/store';
import { createHttpClient } from './api/http';
import type {
  ConversationDto,
  StoryCreatedEvent,
  StoryDeletedEvent,
  StoryDto,
  StoryFeedItem,
  StoryPlaybackDto,
  ConversationReadEvent,
  MessageDto,
  MessageNewEvent,
  Page,
  ReadResult,
} from './api/types';
import { createSocketClient } from './socket/client';
import { browserLock, createAuthStore } from './stores/auth';
import { createConversationsStore } from './stores/conversations';
import { createMessagesStore } from './stores/messages';
import { createStoriesStore } from './stores/stories';
import type { PlaybackLink } from './stories/videoUrls';

/*
 * The app's single instances, wired together. The stores themselves take their dependencies as
 * arguments, so their tests run without a browser, a server or this file.
 */

export const http = createHttpClient({
  baseUrl: PUBLIC_API_URL,
  refresh: (rejectedToken) => auth.renew(rejectedToken),
  onUnauthorized: () => signOut(),
});

export const auth = createAuthStore({ http, lock: browserLock });

export const socket = createSocketClient({ url: PUBLIC_API_URL, onUnauthorized: () => signOut() });

const withToken = () => ({ token: auth.token() });

export const conversations = createConversationsStore({
  list: () => http<ConversationDto[]>('/conversations', withToken()),
  open: (userId) =>
    http<ConversationDto>('/conversations', { ...withToken(), method: 'POST', body: { userId } }),
  get: (id) => http<ConversationDto>(`/conversations/${id}`, withToken()),
});

export const messages = createMessagesStore(
  {
    fetchPage: (id, query) =>
      http<Page<MessageDto, number>>(`/conversations/${id}/messages`, {
        ...withToken(),
        query: { ...query },
      }),
    send: (payload) => socket.request<MessageDto>('message:send', payload),
  },
  () => get(auth).user?.id ?? null,
);

export const stories = createStoriesStore({
  feed: () => http<StoryFeedItem[]>('/stories/feed', withToken()),
  upload: (video, durationMs) => {
    const form = new FormData();
    form.set('durationMs', String(Math.round(durationMs)));
    form.set('video', video, video.type.includes('mp4') ? 'story.mp4' : 'story.webm');
    return http<StoryDto>('/stories', { ...withToken(), method: 'POST', body: form });
  },
  remove: (id) => http<void>(`/stories/${id}`, { ...withToken(), method: 'DELETE' }),
  markSeen: (id) => http<void>(`/stories/${id}/view`, { ...withToken(), method: 'POST' }),
});

/** A link for <video src>, which cannot send a token: the API signs one per story. */
export async function fetchStoryPlayback(id: string): Promise<PlaybackLink> {
  const { videoUrl, expiresAt } = await http<StoryPlaybackDto>(
    `/stories/${id}/playback`,
    withToken(),
  );
  return { url: `${PUBLIC_API_URL}${videoUrl}`, expiresAt: Date.parse(expiresAt) };
}

/** Marks a conversation read up to `seq` and updates its badge in the list. */
export async function markRead(conversationId: string, seq: number): Promise<void> {
  const result = await socket.request<ReadResult>('conversation:read', { conversationId, seq });
  conversations.setUnread(conversationId, result.unreadCount);
}

/**
 * Connects the socket for the signed-in user and routes its events to the stores. On every
 * (re)connect it reloads the list and fetches what the open conversations missed.
 */
export function startRealtime(): () => void {
  if (!auth.token()) return () => {};
  const unsubscribe = [
    socket.on<MessageNewEvent>('message:new', ({ message, conversation }) => {
      conversations.upsert(conversation);
      messages.receive(message);
    }),
    socket.on<ConversationReadEvent>('conversation:read', ({ conversationId, unreadCount }) => {
      conversations.setUnread(conversationId, unreadCount);
    }),
    socket.on<StoryCreatedEvent>('story:created', (event) => {
      const viewerId = get(auth).user?.id;
      if (viewerId) stories.receive(event, viewerId);
    }),
    socket.on<StoryDeletedEvent>('story:deleted', (event) => stories.drop(event)),
    socket.onConnect(() => {
      void conversations.load();
      void stories.load();
      for (const id of messages.loadedConversationIds()) {
        void messages.catchUp(id);
        void messages.retryFailed(id);
      }
    }),
  ];
  socket.connect(() => auth.freshToken().catch(() => auth.token()));
  return () => {
    unsubscribe.forEach((off) => off());
    socket.disconnect();
  };
}

let signingOut = false;

/** Ends the session everywhere in the app; on a refused token too. */
export function signOut(): void {
  if (signingOut) return;
  signingOut = true;
  socket.disconnect();
  auth.logout();
  conversations.reset();
  messages.reset();
  stories.reset();
  void goto(resolve('/(guest)/login')).finally(() => {
    signingOut = false;
  });
}
