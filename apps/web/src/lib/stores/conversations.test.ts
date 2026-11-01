import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationDto } from '../api/types';
import { createConversationsStore, type ConversationsTransport } from './conversations';

function conversation(
  id: string,
  lastMessageAt: string,
  unreadCount = 0,
  seq = 0,
): ConversationDto {
  return {
    id,
    peer: { id: `peer-${id}`, username: `peer${id}`, createdAt: '2026-01-01T00:00:00Z' },
    lastMessage: seq
      ? { id: `m${seq}`, seq, senderId: `peer-${id}`, text: `#${seq}`, createdAt: lastMessageAt }
      : null,
    unreadCount,
    lastMessageAt,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function transport(overrides: Partial<ConversationsTransport> = {}): ConversationsTransport {
  return {
    list: vi.fn(async () => []),
    open: vi.fn(),
    get: vi.fn(),
    ...overrides,
  };
}

describe('conversations store', () => {
  it('loads the list, most recently active first', async () => {
    const store = createConversationsStore(
      transport({
        list: async () => [
          conversation('a', '2026-01-01T10:00:00Z'),
          conversation('b', '2026-01-01T11:00:00Z'),
        ],
      }),
    );
    await store.load();
    expect(get(store).items.map((c) => c.id)).toEqual(['b', 'a']);
    expect(get(store).status).toBe('ready');
  });

  it('keeps the shown list when a reload fails', async () => {
    let fail = false;
    const store = createConversationsStore(
      transport({
        list: async () => {
          if (fail) throw new Error('down');
          return [conversation('a', '2026-01-01T10:00:00Z')];
        },
      }),
    );
    await store.load();
    fail = true;
    await store.load();
    expect(get(store).items).toHaveLength(1);
    expect(get(store).status).toBe('error');
  });

  it('keeps what the socket delivered while the list was in flight', async () => {
    let answer!: (items: ConversationDto[]) => void;
    const store = createConversationsStore(
      transport({ list: () => new Promise((resolve) => (answer = resolve)) }),
    );
    const loading = store.load();
    store.upsert(conversation('new', '2026-01-01T12:00:00Z', 1));
    store.upsert(conversation('a', '2026-01-01T11:00:00Z', 2));
    store.setUnread('b', 0);
    answer([
      conversation('a', '2026-01-01T10:00:00Z', 1),
      conversation('b', '2026-01-01T09:00:00Z', 4),
    ]);
    await loading;

    expect(get(store).items.map((c) => [c.id, c.unreadCount])).toEqual([
      ['new', 1],
      ['a', 2],
      ['b', 0],
    ]);
  });

  it('does not let an older copy of a conversation replace a newer one', () => {
    const store = createConversationsStore(transport());
    store.upsert(conversation('a', '2026-01-01T12:00:00Z', 2, 6));
    store.upsert(conversation('a', '2026-01-01T10:00:00Z', 1, 5));
    expect(get(store).items[0]).toMatchObject({
      lastMessageAt: '2026-01-01T12:00:00Z',
      unreadCount: 2,
    });
  });

  it('orders two messages of the same millisecond by seq', () => {
    const store = createConversationsStore(transport());
    store.upsert(conversation('a', '2026-01-01T12:00:00.000Z', 2, 6));
    store.upsert(conversation('a', '2026-01-01T12:00:00.000Z', 1, 5));
    expect(get(store).items[0]).toMatchObject({ lastMessage: { seq: 6 }, unreadCount: 2 });
  });

  it('keeps the preview when the conversation comes back without messages', () => {
    const store = createConversationsStore(transport());
    store.upsert(conversation('a', '2026-01-01T12:00:00Z', 0, 3));
    store.upsert(conversation('a', '2026-01-01T09:00:00Z'));
    expect(get(store).items[0]!.lastMessage?.seq).toBe(3);
  });

  it('moves a conversation with a new message to the top, or adds a new one', () => {
    const store = createConversationsStore(transport());
    store.upsert(conversation('a', '2026-01-01T10:00:00Z'));
    store.upsert(conversation('b', '2026-01-01T11:00:00Z'));
    store.upsert(conversation('a', '2026-01-01T12:00:00Z', 3));
    store.upsert(conversation('c', '2026-01-01T09:00:00Z'));

    expect(get(store).items.map((c) => [c.id, c.unreadCount])).toEqual([
      ['a', 3],
      ['b', 0],
      ['c', 0],
    ]);
  });

  it('updates the badge when the conversation is read', () => {
    const store = createConversationsStore(transport());
    store.upsert(conversation('a', '2026-01-01T10:00:00Z', 5));
    store.setUnread('a', 0);
    expect(get(store).items[0]!.unreadCount).toBe(0);
  });

  it('fetches a conversation it does not have yet, once', async () => {
    const get_ = vi.fn(async (id: string) => conversation(id, '2026-01-01T10:00:00Z'));
    const store = createConversationsStore(transport({ get: get_ }));
    await store.ensure('x');
    await store.ensure('x');
    expect(get_).toHaveBeenCalledOnce();
    expect(get(store).items.map((c) => c.id)).toEqual(['x']);
  });
});
