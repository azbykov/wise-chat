import { get, writable, type Readable } from 'svelte/store';
import { ApiError, errorMessage } from '../api/http';
import type { MessageDto, Page } from '../api/types';

export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  /** Stable list key: the client id survives the switch from "sending" to "sent". */
  key: string;
  id: string | null;
  seq: number | null;
  conversationId: string;
  senderId: string;
  text: string;
  clientMessageId: string;
  createdAt: string;
  status: MessageStatus;
  error?: string;
  /** A failed send that never got an answer (network): safe to resend on its own. */
  retryable?: boolean;
}

export interface Thread {
  items: ChatMessage[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** Older messages exist on the server that are not loaded. */
  hasMore: boolean;
  loadingOlder: boolean;
}

export type MessagesState = Record<string, Thread>;

export interface HistoryQuery {
  before?: number;
  after?: number;
  limit?: number;
}

export interface MessagesTransport {
  fetchPage(conversationId: string, query: HistoryQuery): Promise<Page<MessageDto, number>>;
  /** Sends over the socket; rejects with ApiError (status 0 when there was no answer). */
  send(payload: {
    conversationId: string;
    text: string;
    clientMessageId: string;
  }): Promise<MessageDto>;
}

export interface MessagesStore extends Readable<MessagesState> {
  loadLatest(conversationId: string): Promise<void>;
  loadOlder(conversationId: string): Promise<void>;
  /** Fetches everything after the last message held without a gap: after a reconnect or a hole. */
  catchUp(conversationId: string): Promise<void>;
  receive(message: MessageDto): void;
  send(conversationId: string, text: string): Promise<void>;
  retry(conversationId: string, clientMessageId: string): Promise<void>;
  /** Resends the network-failed messages one by one in the order typed, with their client ids. */
  retryFailed(conversationId: string): Promise<void>;
  /** The newest stored message number, for marking the conversation read. */
  newestSeq(conversationId: string): number;
  loadedConversationIds(): string[];
  reset(): void;
}

const PAGE_SIZE = 30;
const CATCH_UP_PAGE = 100;
/** Events of two concurrent sends can arrive in either order: wait before calling it a hole. */
export const GAP_WAIT_MS = 1000;

function confirmed(message: MessageDto): ChatMessage {
  return { ...message, key: message.clientMessageId, status: 'sent' };
}

/** Stored messages by number, then the ones still on their way, in the order they were typed. */
function order(items: ChatMessage[]): ChatMessage[] {
  const stored = items.filter((m) => m.seq !== null).sort((a, b) => a.seq! - b.seq!);
  return [...stored, ...items.filter((m) => m.seq === null)];
}

/** Server messages replace their optimistic copies (same client id); repeats are dropped. */
function merge(items: ChatMessage[], incoming: MessageDto[]): ChatMessage[] {
  const byKey = new Map(items.map((m) => [m.key, m]));
  for (const message of incoming) {
    byKey.set(message.clientMessageId, confirmed(message));
  }
  return order([...byKey.values()]);
}

/** The number up to which the thread has no holes. History not loaded yet is not a hole. */
export function contiguousSeq(thread: Pick<Thread, 'items' | 'hasMore'>): number {
  const seqs = thread.items.flatMap((m) => (m.seq === null ? [] : [m.seq]));
  let last = thread.hasMore ? (seqs[0] ?? 1) - 1 : 0;
  for (const seq of seqs) {
    if (seq !== last + 1) break;
    last = seq;
  }
  return last;
}

function newest(thread: Thread | undefined): number {
  return thread?.items.findLast((m) => m.seq !== null)?.seq ?? 0;
}

export function createMessagesStore(
  transport: MessagesTransport,
  currentUserId: () => string | null,
  options: { gapWaitMs?: number; newId?: () => string } = {},
): MessagesStore {
  const state = writable<MessagesState>({});
  const gapWaitMs = options.gapWaitMs ?? GAP_WAIT_MS;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const gapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const catchingUp = new Map<string, Promise<void>>();
  const resending = new Map<string, Promise<void>>();

  function update(conversationId: string, change: (thread: Thread) => Thread) {
    state.update((s) => {
      const thread = s[conversationId];
      return thread ? { ...s, [conversationId]: change(thread) } : s;
    });
  }

  function setMessage(conversationId: string, key: string, change: Partial<ChatMessage>) {
    update(conversationId, (t) => ({
      ...t,
      items: t.items.map((m) => (m.key === key ? { ...m, ...change } : m)),
    }));
  }

  function hasHole(conversationId: string): boolean {
    const thread = get(state)[conversationId];
    return !!thread && thread.status === 'ready' && newest(thread) > contiguousSeq(thread);
  }

  function watchForHole(conversationId: string) {
    if (!hasHole(conversationId) || gapTimers.has(conversationId)) return;
    gapTimers.set(
      conversationId,
      setTimeout(() => {
        gapTimers.delete(conversationId);
        if (hasHole(conversationId)) void catchUp(conversationId);
      }, gapWaitMs),
    );
  }

  async function deliver(conversationId: string, message: ChatMessage) {
    try {
      const stored = await transport.send({
        conversationId,
        text: message.text,
        clientMessageId: message.clientMessageId,
      });
      update(conversationId, (t) => ({ ...t, items: merge(t.items, [stored]) }));
      watchForHole(conversationId);
    } catch (error) {
      const retryable = error instanceof ApiError && error.retryable;
      setMessage(conversationId, message.key, {
        status: 'failed',
        retryable,
        error: retryable ? 'Not sent' : errorMessage(error),
      });
    }
  }

  function catchUp(conversationId: string): Promise<void> {
    const running = catchingUp.get(conversationId);
    if (running) return running;
    const run = (async () => {
      let hasMore = true;
      while (hasMore) {
        const thread = get(state)[conversationId];
        if (!thread) return;
        const page = await transport.fetchPage(conversationId, {
          after: contiguousSeq(thread),
          limit: CATCH_UP_PAGE,
        });
        update(conversationId, (t) => ({ ...t, items: merge(t.items, page.items) }));
        hasMore = page.nextCursor !== null && page.items.length > 0;
      }
    })()
      .catch(() => {
        // The next reconnect or new message tries again.
      })
      .finally(() => catchingUp.delete(conversationId));
    catchingUp.set(conversationId, run);
    return run;
  }

  return {
    subscribe: state.subscribe,

    async loadLatest(conversationId) {
      state.update((s) => ({
        ...s,
        [conversationId]: s[conversationId]
          ? { ...s[conversationId]!, error: null }
          : { items: [], status: 'loading', error: null, hasMore: false, loadingOlder: false },
      }));
      try {
        const page = await transport.fetchPage(conversationId, { limit: PAGE_SIZE });
        update(conversationId, (t) => ({
          ...t,
          items: merge(t.items, page.items),
          status: 'ready',
          hasMore: (t.status === 'ready' && t.hasMore) || page.nextCursor !== null,
        }));
        watchForHole(conversationId);
      } catch (error) {
        // A thread already on screen stays there: the reconnect catches it up. Only a first
        // load that fails has nothing to show but the error.
        update(conversationId, (t) =>
          t.status === 'ready'
            ? { ...t, error: errorMessage(error) }
            : { ...t, status: 'error', error: errorMessage(error) },
        );
      }
    },

    async loadOlder(conversationId) {
      const thread = get(state)[conversationId];
      const oldest = thread?.items.flatMap((m) => (m.seq === null ? [] : [m.seq]))[0];
      if (!thread || !thread.hasMore || thread.loadingOlder || oldest === undefined) return;
      update(conversationId, (t) => ({ ...t, loadingOlder: true }));
      try {
        const page = await transport.fetchPage(conversationId, {
          before: oldest,
          limit: PAGE_SIZE,
        });
        update(conversationId, (t) => ({
          ...t,
          items: merge(t.items, page.items),
          hasMore: page.nextCursor !== null,
          loadingOlder: false,
        }));
      } catch (error) {
        update(conversationId, (t) => ({ ...t, loadingOlder: false, error: errorMessage(error) }));
      }
    },

    catchUp,

    receive(message) {
      if (!get(state)[message.conversationId]) return; // Loaded when the conversation is opened.
      update(message.conversationId, (t) => ({ ...t, items: merge(t.items, [message]) }));
      watchForHole(message.conversationId);
    },

    async send(conversationId, text) {
      const userId = currentUserId();
      if (!userId || !get(state)[conversationId]) return;
      const clientMessageId = newId();
      const message: ChatMessage = {
        key: clientMessageId,
        id: null,
        seq: null,
        conversationId,
        senderId: userId,
        text,
        clientMessageId,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      update(conversationId, (t) => ({ ...t, items: [...t.items, message] }));
      await deliver(conversationId, message);
    },

    async retry(conversationId, clientMessageId) {
      const message = get(state)[conversationId]?.items.find((m) => m.key === clientMessageId);
      if (!message || message.status !== 'failed') return;
      setMessage(conversationId, message.key, { status: 'sending', error: undefined });
      await deliver(conversationId, { ...message, status: 'sending' });
    },

    retryFailed(conversationId) {
      const running = resending.get(conversationId);
      if (running) return running;
      const run = (async () => {
        const keys = (get(state)[conversationId]?.items ?? [])
          .filter((m) => m.status === 'failed' && m.retryable)
          .map((m) => m.key);
        for (const key of keys) {
          const message = get(state)[conversationId]?.items.find((m) => m.key === key);
          if (!message || message.status !== 'failed') continue;
          setMessage(conversationId, key, { status: 'sending', error: undefined });
          await deliver(conversationId, { ...message, status: 'sending' });
          // Still no answer: the connection is gone again, the next reconnect continues.
          if (get(state)[conversationId]?.items.find((m) => m.key === key)?.status === 'failed') {
            break;
          }
        }
      })().finally(() => resending.delete(conversationId));
      resending.set(conversationId, run);
      return run;
    },

    newestSeq: (conversationId) => newest(get(state)[conversationId]),

    loadedConversationIds: () => Object.keys(get(state)),

    reset() {
      gapTimers.forEach(clearTimeout);
      gapTimers.clear();
      state.set({});
    },
  };
}
