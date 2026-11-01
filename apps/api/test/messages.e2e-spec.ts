import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { RealtimeService } from '../src/realtime/realtime.service';
import { openConversation, sendMessage } from './helpers/conversations';
import { createTestApp, type TestApp } from './helpers/app';
import { registerUser, type TestUser } from './helpers/users';

describe('messages', () => {
  let t: TestApp;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let counter = 0;

  beforeAll(async () => {
    t = await createTestApp();
    [alice, bob, carol] = await Promise.all([
      registerUser(t.http, 'alice'),
      registerUser(t.http, 'bob'),
      registerUser(t.http, 'carol'),
    ]);
  });

  afterAll(async () => {
    await t.close();
  });

  /** A fresh pair for each test, so counters and numbers start from zero. */
  async function pair(): Promise<{ a: TestUser; b: TestUser; id: string }> {
    counter += 1;
    const [a, b] = await Promise.all([
      registerUser(t.http, `pair_a${counter}`),
      registerUser(t.http, `pair_b${counter}`),
    ]);
    return { a, b, id: await openConversation(t.http, a, b) };
  }

  const conversationOf = async (user: TestUser, id: string) =>
    (await request(t.http).get(`/api/conversations/${id}`).set(user.auth).expect(200)).body;
  const history = (user: TestUser, id: string, query: Record<string, number> = {}) =>
    request(t.http).get(`/api/conversations/${id}/messages`).query(query).set(user.auth);
  const read = (user: TestUser, id: string, seq: number) =>
    request(t.http).post(`/api/conversations/${id}/read`).set(user.auth).send({ seq });

  /** unread[u] must equal the peer's messages after lastReadSeq[u], for both users. */
  async function expectUnreadInvariant(id: string, a: TestUser, b: TestUser) {
    const db = t.app.get<Connection>(getConnectionToken());
    const conversation = await db
      .collection('conversations')
      .findOne({ _id: new Types.ObjectId(id) });
    for (const [user, peer] of [
      [a, b],
      [b, a],
    ] as const) {
      const lastRead = conversation!.lastReadSeq[user.id] ?? 0;
      const expected = await db.collection('messages').countDocuments({
        conversationId: new Types.ObjectId(id),
        senderId: new Types.ObjectId(peer.id),
        seq: { $gt: lastRead },
      });
      expect(conversation!.unread[user.id]).toBe(expected);
    }
  }

  describe('send', () => {
    it('stores the message as number 1 and updates the conversation for both sides', async () => {
      const { a, b, id } = await pair();
      const res = await sendMessage(t.http, a, id, '  Hello, Bob!\nHow are you?  ').expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        conversationId: id,
        seq: 1,
        senderId: a.id,
        text: 'Hello, Bob!\nHow are you?',
        clientMessageId: expect.any(String),
        createdAt: expect.any(String),
      });

      const forA = await conversationOf(a, id);
      const forB = await conversationOf(b, id);
      expect(forA.lastMessage).toMatchObject({ id: res.body.id, seq: 1, senderId: a.id });
      expect(forA.lastMessageAt).toBe(res.body.createdAt);
      expect(forA.unreadCount).toBe(0);
      expect(forB.unreadCount).toBe(1);
    });

    it.each([
      ['empty', ''],
      ['only whitespace', '   \n\t '],
      ['too long', 'x'.repeat(2001)],
      ['a control character', 'bell\u0007'],
    ])('refuses a message that is %s', async (_case, text) => {
      const { a, id } = await pair();
      const res = await sendMessage(t.http, a, id, text).expect(400);
      expect(res.body.details[0].path).toBe('text');
    });

    it('refuses a missing or malformed clientMessageId', async () => {
      const { a, id } = await pair();
      await request(t.http)
        .post(`/api/conversations/${id}/messages`)
        .set(a.auth)
        .send({ text: 'hi' })
        .expect(400);
      await sendMessage(t.http, a, id, 'hi', 'not-a-uuid').expect(400);
    });

    it('keeps outsiders out', async () => {
      const id = await openConversation(t.http, alice, bob);
      await sendMessage(t.http, carol, id, 'let me in').expect(403);
      await history(carol, id).expect(403);
      await read(carol, id, 1).expect(403);
    });

    it('treats a retry as the same message: same id, same number, delivered again', async () => {
      const { a, b, id } = await pair();
      const emit = jest.spyOn(t.app.get(RealtimeService), 'emitToUsers');
      const clientMessageId = randomUUID();

      const first = await sendMessage(t.http, a, id, 'once', clientMessageId).expect(201);
      emit.mockClear();
      const retry = await sendMessage(t.http, a, id, 'once', clientMessageId).expect(200);

      expect(retry.body).toEqual(first.body);
      expect((await history(a, id).expect(200)).body.items).toHaveLength(1);
      expect((await conversationOf(b, id)).unreadCount).toBe(1);
      // Delivered again: the first attempt may have lost its broadcast.
      expect(emit).toHaveBeenCalledWith([b.id], 'message:new', expect.anything());
      emit.mockRestore();
    });

    it('stores one message when the same retry races in several times', async () => {
      const { a, id } = await pair();
      const clientMessageId = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => sendMessage(t.http, a, id, 'race', clientMessageId)),
      );
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect((await history(a, id).expect(200)).body.items).toHaveLength(1);
    });

    it('refuses a clientMessageId already used in another conversation', async () => {
      const { a, id } = await pair();
      const other = await openConversation(t.http, a, carol);
      const clientMessageId = randomUUID();
      await sendMessage(t.http, a, id, 'here', clientMessageId).expect(201);
      const res = await sendMessage(t.http, a, other, 'there', clientMessageId).expect(409);
      expect(res.body.error).toBe('Conflict');
    });

    it('numbers 20 concurrent sends from both sides 1..20 without gaps', async () => {
      const { a, b, id } = await pair();
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => sendMessage(t.http, i % 2 ? b : a, id, `m${i}`)),
      );
      expect(responses.every((r) => r.status === 201)).toBe(true);
      const seqs = responses.map((r) => r.body.seq).sort((x, y) => x - y);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

      const items = (await history(a, id, { limit: 100 }).expect(200)).body.items;
      expect(items.map((m: { seq: number }) => m.seq)).toEqual(seqs);
      const forA = await conversationOf(a, id);
      expect(forA.lastMessage.seq).toBe(20);
      expect(forA.lastMessage.id).toBe(items[19].id);
      await expectUnreadInvariant(id, a, b);
    });

    it('tells each participant about the message with their own view of the conversation', async () => {
      const { a, b, id } = await pair();
      const emit = jest.spyOn(t.app.get(RealtimeService), 'emitToUsers');
      const sent = await sendMessage(t.http, a, id, 'ping').expect(201);

      const calls = emit.mock.calls.filter(([, event]) => event === 'message:new');
      const byUser = new Map(calls.map(([[userId], , payload]) => [userId, payload]));
      expect(byUser.get(a.id)).toMatchObject({
        message: sent.body,
        conversation: { id, peer: { id: b.id }, unreadCount: 0 },
      });
      expect(byUser.get(b.id)).toMatchObject({
        message: sent.body,
        conversation: { id, peer: { id: a.id }, unreadCount: 1 },
      });
      emit.mockRestore();
    });
  });

  describe('history', () => {
    let a: TestUser;
    let id: string;

    beforeAll(async () => {
      ({ a, id } = await pair());
      for (let i = 1; i <= 7; i++) {
        await sendMessage(t.http, a, id, `m${i}`).expect(201);
      }
    });

    const seqsOf = (body: { items: { seq: number }[] }) => body.items.map((m) => m.seq);

    it('returns the newest page in order, oldest first', async () => {
      const res = await history(a, id, { limit: 3 }).expect(200);
      expect(seqsOf(res.body)).toEqual([5, 6, 7]);
      expect(res.body.nextCursor).toBe(5);
    });

    it('pages back with before', async () => {
      const res = await history(a, id, { before: 5, limit: 3 }).expect(200);
      expect(seqsOf(res.body)).toEqual([2, 3, 4]);
      const last = await history(a, id, { before: 2, limit: 3 }).expect(200);
      expect(seqsOf(last.body)).toEqual([1]);
      expect(last.body.nextCursor).toBeNull();
    });

    it('catches up with after', async () => {
      const res = await history(a, id, { after: 4, limit: 2 }).expect(200);
      expect(seqsOf(res.body)).toEqual([5, 6]);
      expect(res.body.nextCursor).toBe(6);
      expect(seqsOf((await history(a, id, { after: 7 }).expect(200)).body)).toEqual([]);
    });

    it('refuses before and after together, and limits out of range', async () => {
      await history(a, id, { before: 5, after: 1 }).expect(400);
      await history(a, id, { limit: 0 }).expect(400);
      await history(a, id, { limit: 101 }).expect(400);
    });
  });

  describe('read', () => {
    it('counts what is left after reading up to a message', async () => {
      const { a, b, id } = await pair();
      for (let i = 1; i <= 5; i++) {
        await sendMessage(t.http, a, id, `m${i}`).expect(201);
      }
      expect((await read(b, id, 3).expect(200)).body).toEqual({ lastReadSeq: 3, unreadCount: 2 });
      expect((await conversationOf(b, id)).unreadCount).toBe(2);
      expect((await read(b, id, 5).expect(200)).body).toEqual({ lastReadSeq: 5, unreadCount: 0 });
    });

    it('never moves the marker back or past the newest message', async () => {
      const { a, b, id } = await pair();
      for (let i = 1; i <= 3; i++) {
        await sendMessage(t.http, a, id, `m${i}`).expect(201);
      }
      expect((await read(b, id, 99).expect(200)).body).toEqual({ lastReadSeq: 3, unreadCount: 0 });
      expect((await read(b, id, 1).expect(200)).body).toEqual({ lastReadSeq: 3, unreadCount: 0 });
    });

    it('counts only the peer’s messages, and a reply clears your own count', async () => {
      const { a, b, id } = await pair();
      await sendMessage(t.http, a, id, 'from a').expect(201);
      await sendMessage(t.http, b, id, 'reply from b').expect(201);
      await sendMessage(t.http, a, id, 'again from a').expect(201);
      // b replied after a's first message, so only a's last one is unread for b.
      expect((await conversationOf(b, id)).unreadCount).toBe(1);
      expect((await conversationOf(a, id)).unreadCount).toBe(0);
      await expectUnreadInvariant(id, a, b);
    });

    it('tells every tab of the reader, and only when something changed', async () => {
      const { a, b, id } = await pair();
      await sendMessage(t.http, a, id, 'm1').expect(201);
      const emit = jest.spyOn(t.app.get(RealtimeService), 'emitToUsers');

      await read(b, id, 1).expect(200);
      expect(emit).toHaveBeenCalledWith([b.id], 'conversation:read', {
        conversationId: id,
        lastReadSeq: 1,
        unreadCount: 0,
      });
      emit.mockClear();
      await read(b, id, 1).expect(200);
      expect(emit).not.toHaveBeenCalled();
      emit.mockRestore();
    });

    it('keeps the counters right while reads and sends run side by side', async () => {
      const { a, b, id } = await pair();
      const work = Array.from({ length: 30 }, (_, i) => {
        if (i % 3 === 0) return read(b, id, Math.ceil(i / 2));
        if (i % 3 === 1) return read(a, id, i);
        return sendMessage(t.http, i % 2 ? a : b, id, `m${i}`);
      });
      const responses = await Promise.all(work);
      expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      await expectUnreadInvariant(id, a, b);
    });

    it('refuses a negative or missing seq', async () => {
      const { b, id } = await pair();
      await read(b, id, -1).expect(400);
      await request(t.http).post(`/api/conversations/${id}/read`).set(b.auth).send({}).expect(400);
    });
  });
});
