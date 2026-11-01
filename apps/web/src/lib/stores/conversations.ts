import { get, writable, type Readable } from 'svelte/store';
import { errorMessage } from '../api/http';
import type { ConversationDto } from '../api/types';

export interface ConversationsState {
  items: ConversationDto[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

export interface ConversationsTransport {
  list(): Promise<ConversationDto[]>;
  open(userId: string): Promise<ConversationDto>;
  get(id: string): Promise<ConversationDto>;
}

export interface ConversationsStore extends Readable<ConversationsState> {
  /**
   * (Re)loads the list; a reload keeps what is shown until the new list arrives, and what
   * the socket delivered meanwhile survives it.
   */
  load(): Promise<void>;
  /** Puts a conversation the server sent (new message, open) in its place by activity. */
  upsert(conversation: ConversationDto): void;
  setUnread(conversationId: string, unreadCount: number): void;
  /** Opens (or creates) the conversation with a user. */
  open(userId: string): Promise<ConversationDto>;
  /** The conversation from the list, fetched when it is not there (a link, a reload). */
  ensure(id: string): Promise<ConversationDto>;
  reset(): void;
}

const INITIAL: ConversationsState = { items: [], status: 'idle', error: null };

/** Most recent activity first; the id settles ties, as on the server. */
function byActivity(a: ConversationDto, b: ConversationDto): number {
  return b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id);
}

/** The conversation's place in its own history: two messages may share a millisecond, not a seq. */
const seqOf = (c: ConversationDto) => c.lastMessage?.seq ?? 0;

type Change = (items: ConversationDto[]) => ConversationDto[];

export function createConversationsStore(transport: ConversationsTransport): ConversationsStore {
  const state = writable<ConversationsState>(INITIAL);
  let loading: Promise<void> | null = null;
  // Changes made while the list is in flight: the snapshot may predate them, so they are
  // applied again on top of it.
  let missed: Change[] | null = null;

  function apply(change: Change) {
    missed?.push(change);
    state.update((s) => ({ ...s, items: change(s.items) }));
  }

  function upsert(conversation: ConversationDto) {
    apply((items) => {
      const known = items.find((c) => c.id === conversation.id);
      if (known && seqOf(known) > seqOf(conversation)) return items;
      return [...items.filter((c) => c.id !== conversation.id), conversation].sort(byActivity);
    });
  }

  async function load() {
    loading ??= (async () => {
      const changes: Change[] = [];
      missed = changes;
      state.update((s) => ({ ...s, status: s.items.length ? s.status : 'loading', error: null }));
      try {
        const snapshot = [...(await transport.list())].sort(byActivity);
        const items = changes.reduce((items, change) => change(items), snapshot);
        state.set({ items, status: 'ready', error: null });
      } catch (error) {
        state.update((s) => ({ ...s, status: 'error', error: errorMessage(error) }));
      }
    })().finally(() => {
      loading = null;
      missed = null;
    });
    return loading;
  }

  return {
    subscribe: state.subscribe,
    load,
    upsert,
    setUnread(conversationId, unreadCount) {
      apply((items) => items.map((c) => (c.id === conversationId ? { ...c, unreadCount } : c)));
    },
    async open(userId) {
      const conversation = await transport.open(userId);
      upsert(conversation);
      return conversation;
    },
    async ensure(id) {
      const known = get(state).items.find((c) => c.id === id);
      if (known) return known;
      const conversation = await transport.get(id);
      upsert(conversation);
      return conversation;
    },
    reset() {
      state.set(INITIAL);
    },
  };
}
