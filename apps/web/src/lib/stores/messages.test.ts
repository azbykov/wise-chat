import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import type { MessageDto, Page } from '../api/types';
import { contiguousSeq, createMessagesStore, type MessagesTransport } from './messages';

const C = 'conv1';
const ME = 'me';
const PEER = 'peer';

function message(seq: number, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: `m${seq}`,
    conversationId: C,
    seq,
    senderId: PEER,
    text: `text ${seq}`,
    clientMessageId: `client-${seq}`,
    createdAt: `2026-01-01T10:00:${String(seq).padStart(2, '0')}Z`,
    ...overrides,
  };
}

/** A server holding `stored` messages, answering pages the way the API does. */
function server(stored: MessageDto[]) {
  const fetchPage = vi.fn(
    async (_id: string, query: { before?: number; after?: number; limit?: number }) => {
      const limit = query.limit ?? 30;
      let items: MessageDto[];
      if (query.after !== undefined) {
        items = stored.filter((m) => m.seq > query.after!).slice(0, limit + 1);
        const page = items.slice(0, limit);
        return {
          items: page,
          nextCursor: items.length > limit ? page[page.length - 1]!.seq : null,
        } satisfies Page<MessageDto, number>;
      }
      items = stored
        .filter((m) => query.before === undefined || m.seq < query.before)
        .slice(-(limit + 1));
      const page = items.length > limit ? items.slice(1) : items;
      return {
        items: page,
        nextCursor: items.length > limit ? page[0]!.seq : null,
      } satisfies Page<MessageDto, number>;
    },
  );
  return { stored, fetchPage };
}

function setup(stored: MessageDto[] = [], send?: MessagesTransport['send']) {
  const api = server(stored);
  let n = 0;
  const transport: MessagesTransport = {
    fetchPage: api.fetchPage,
    send:
      send ?? vi.fn(async (payload) => message(stored.length + 1, { ...payload, senderId: ME })),
  };
  const store = createMessagesStore(transport, () => ME, {
    gapWaitMs: 1000,
    newId: () => `new-${++n}`,
  });
  return { store, api, transport, thread: () => get(store)[C]! };
}

const seqs = (thread: { items: { seq: number | null }[] }) => thread.items.map((m) => m.seq);

describe('messages store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads the newest page and pages back', async () => {
    const all = Array.from({ length: 40 }, (_, i) => message(i + 1));
    const { store, thread } = setup(all);

    await store.loadLatest(C);
    expect(seqs(thread())).toEqual(all.slice(10).map((m) => m.seq));
    expect(thread().hasMore).toBe(true);

    await store.loadOlder(C);
    expect(seqs(thread())).toHaveLength(40);
    expect(thread().hasMore).toBe(false);
  });

  it('shows a message at once and replaces it with the stored one', async () => {
    let resolveSend!: (m: MessageDto) => void;
    const { store, thread } = setup(
      [],
      () => new Promise<MessageDto>((resolve) => (resolveSend = resolve)),
    );
    await store.loadLatest(C);

    const sending = store.send(C, 'hello');
    expect(thread().items).toMatchObject([{ text: 'hello', status: 'sending', seq: null }]);

    resolveSend(message(1, { senderId: ME, text: 'hello', clientMessageId: 'new-1' }));
    await sending;
    expect(thread().items).toMatchObject([{ key: 'new-1', text: 'hello', status: 'sent', seq: 1 }]);
  });

  it('keeps one copy when the ack and the socket event both arrive', async () => {
    const { store, thread } = setup();
    await store.loadLatest(C);
    await store.send(C, 'hi');
    store.receive(message(1, { senderId: ME, text: 'hi', clientMessageId: 'new-1' }));
    store.receive(message(1, { senderId: ME, text: 'hi', clientMessageId: 'new-1' }));
    expect(thread().items).toHaveLength(1);
  });

  it('marks a message that could not be sent, and sends it again with the same id', async () => {
    const send = vi
      .fn<MessagesTransport['send']>()
      .mockRejectedValueOnce(ApiError.network())
      .mockImplementation(async (p) => message(1, { ...p, senderId: ME }));
    const { store, thread } = setup([], send);
    await store.loadLatest(C);

    await store.send(C, 'retry me');
    expect(thread().items).toMatchObject([{ status: 'failed', error: 'Not sent' }]);

    await store.retry(C, 'new-1');
    expect(thread().items).toMatchObject([{ status: 'sent', seq: 1 }]);
    expect(send.mock.calls.map(([p]) => p.clientMessageId)).toEqual(['new-1', 'new-1']);
  });

  it('resends network failures one by one in typed order, leaving refused ones alone', async () => {
    let online = false;
    let seq = 0;
    const send = vi.fn<MessagesTransport['send']>(async (p) => {
      if (!online) throw ApiError.network();
      return message(++seq, { ...p, senderId: ME });
    });
    const { store, thread } = setup([], send);
    await store.loadLatest(C);
    await store.send(C, 'first');
    await store.send(C, 'second');
    expect(thread().items.map((m) => m.status)).toEqual(['failed', 'failed']);

    online = true;
    await store.retryFailed(C);
    expect(thread().items).toMatchObject([
      { text: 'first', status: 'sent', seq: 1 },
      { text: 'second', status: 'sent', seq: 2 },
    ]);
    expect(send.mock.calls.slice(2).map(([p]) => p.clientMessageId)).toEqual(['new-1', 'new-2']);
  });

  it('stops resending when the connection is still down', async () => {
    const send = vi.fn<MessagesTransport['send']>(async () => {
      throw ApiError.network();
    });
    const { store, thread } = setup([], send);
    await store.loadLatest(C);
    await store.send(C, 'a');
    await store.send(C, 'b');
    send.mockClear();
    await store.retryFailed(C);
    expect(send).toHaveBeenCalledTimes(1);
    expect(thread().items.map((m) => m.status)).toEqual(['failed', 'failed']);
  });

  it('shows the server’s reason when it refused the message', async () => {
    const send = vi.fn(async () => {
      throw new ApiError(403, 'You are not a participant of this conversation');
    });
    const { store, thread } = setup([], send);
    await store.loadLatest(C);
    await store.send(C, 'nope');
    expect(thread().items[0]).toMatchObject({
      status: 'failed',
      error: 'You are not a participant of this conversation',
    });
  });

  it('keeps sent messages in number order, pending ones after them', async () => {
    const { store, thread } = setup([message(1)]);
    await store.loadLatest(C);
    store.receive(message(3));
    store.receive(message(2));
    expect(seqs(thread())).toEqual([1, 2, 3]);
  });

  it('fetches what is missing when a number is skipped', async () => {
    const all = [message(1), message(2), message(3)];
    const { store, api, thread } = setup(all.slice(0, 1));
    await store.loadLatest(C);

    // Message 2 never arrives over the socket; 3 does.
    api.stored.push(all[1]!, all[2]!);
    store.receive(all[2]!);
    expect(seqs(thread())).toEqual([1, 3]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(api.fetchPage).toHaveBeenLastCalledWith(C, { after: 1, limit: 100 });
    expect(seqs(thread())).toEqual([1, 2, 3]);
  });

  it('does not fetch when the skipped message arrives within the wait', async () => {
    const { store, api } = setup([message(1)]);
    await store.loadLatest(C);
    api.fetchPage.mockClear();

    store.receive(message(3));
    store.receive(message(2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.fetchPage).not.toHaveBeenCalled();
  });

  it('catches up page by page after a reconnect', async () => {
    const { store, api, thread } = setup([message(1)]);
    await store.loadLatest(C);
    for (let seq = 2; seq <= 150; seq++) api.stored.push(message(seq));

    await store.catchUp(C);
    expect(seqs(thread())).toHaveLength(150);
    expect(api.fetchPage).toHaveBeenCalledWith(C, { after: 101, limit: 100 });
  });

  it('keeps a loaded thread, unsent messages included, when a reload fails', async () => {
    const send = vi.fn(async () => {
      throw ApiError.network();
    });
    const { store, api, thread } = setup([message(1)], send);
    await store.loadLatest(C);
    await store.send(C, 'offline');
    api.fetchPage.mockRejectedValueOnce(ApiError.network());

    await store.loadLatest(C);
    expect(thread().status).toBe('ready');
    expect(thread().items.map((m) => [m.seq, m.status])).toEqual([
      [1, 'sent'],
      [null, 'failed'],
    ]);
  });

  it('shows the error when the first load fails', async () => {
    const { store, api, thread } = setup();
    api.fetchPage.mockRejectedValueOnce(ApiError.network());
    await store.loadLatest(C);
    expect(thread()).toMatchObject({ status: 'error', error: expect.stringContaining('reach') });
  });

  it('ignores messages for a conversation that is not loaded', () => {
    const { store } = setup();
    store.receive(message(1));
    expect(get(store)[C]).toBeUndefined();
  });
});

describe('contiguousSeq', () => {
  const thread = (seqs: number[], hasMore = false) => ({
    hasMore,
    items: seqs.map((seq) => ({ seq }) as never),
  });

  it('stops at the first hole', () => {
    expect(contiguousSeq(thread([1, 2, 4]))).toBe(2);
  });

  it('does not count unloaded older history as a hole', () => {
    expect(contiguousSeq(thread([31, 32, 33], true))).toBe(33);
  });

  it('is 0 for an empty thread', () => {
    expect(contiguousSeq(thread([]))).toBe(0);
  });
});
