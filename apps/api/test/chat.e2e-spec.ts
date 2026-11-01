import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io-client';
import { SessionService } from '../src/auth/session.service';
import { openConversation, sendMessage } from './helpers/conversations';
import { createTestApp, type TestApp } from './helpers/app';
import { connect, emitWithAck, nextEvent, pause, record } from './helpers/sockets';
import { registerUser, type TestUser } from './helpers/users';

interface MessageNew {
  message: { id: string; seq: number; senderId: string; text: string; clientMessageId: string };
  conversation: {
    id: string;
    peer: { id: string };
    unreadCount: number;
    lastMessage: { seq: number };
  };
}

type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { statusCode: number; error: string; message: string; details?: unknown } };

describe('chat gateway', () => {
  let t: TestApp;
  let counter = 0;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.close());
  });

  afterAll(async () => {
    await t.close();
  });

  async function client(user: TestUser): Promise<Socket> {
    const socket = await connect(t.url, user.token);
    sockets.push(socket);
    return socket;
  }

  async function pair() {
    counter += 1;
    const [a, b] = await Promise.all([
      registerUser(t.http, `sock_a${counter}`),
      registerUser(t.http, `sock_b${counter}`),
    ]);
    return { a, b, id: await openConversation(t.http, a, b) };
  }

  const send = (
    socket: Socket,
    conversationId: string,
    text: string,
    clientMessageId = randomUUID(),
  ) =>
    emitWithAck<Ack<MessageNew['message']>>(socket, 'message:send', {
      conversationId,
      text,
      clientMessageId,
    });

  describe('handshake', () => {
    it('refuses a socket without a token', async () => {
      await expect(connect(t.url)).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
    });

    it('refuses a forged token', async () => {
      await expect(connect(t.url, 'not.a.jwt')).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' },
      });
    });

    it('tells an expired token apart, so the client signs in again', async () => {
      const { a } = await pair();
      const expired = await t.app
        .get(JwtService)
        .signAsync({ username: a.username }, { subject: a.id, expiresIn: -10 });
      await expect(connect(t.url, expired)).rejects.toMatchObject({
        data: { code: 'TOKEN_EXPIRED' },
      });
    });

    it('does not take a failed session check for an ended session', async () => {
      const { a } = await pair();
      const exists = jest
        .spyOn(t.app.get(SessionService), 'exists')
        .mockRejectedValueOnce(new Error('connection refused'));
      try {
        await expect(connect(t.url, a.token)).rejects.toMatchObject({
          data: { code: 'UNAVAILABLE' },
        });
      } finally {
        exists.mockRestore();
      }
      await expect(client(a)).resolves.toMatchObject({ connected: true });
    });
  });

  describe('message:send', () => {
    it('acks the stored message and delivers it to the peer with their view', async () => {
      const { a, b, id } = await pair();
      const [socketA, socketB] = await Promise.all([client(a), client(b)]);
      const delivered = nextEvent<MessageNew>(socketB, 'message:new');

      const ack = await send(socketA, id, 'hello over the socket');

      expect(ack).toEqual({
        ok: true,
        data: expect.objectContaining({ seq: 1, senderId: a.id, text: 'hello over the socket' }),
      });
      const event = await delivered;
      expect(event.message).toEqual(ack.ok && ack.data);
      expect(event.conversation).toMatchObject({ id, peer: { id: a.id }, unreadCount: 1 });
    });

    it('reaches every tab of both users, the sending one included', async () => {
      const { a, b, id } = await pair();
      const [tab1, tab2, bob] = await Promise.all([client(a), client(a), client(b)]);
      const events = Promise.all([
        nextEvent<MessageNew>(tab1, 'message:new'),
        nextEvent<MessageNew>(tab2, 'message:new'),
        nextEvent<MessageNew>(bob, 'message:new'),
      ]);

      const ack = await send(tab1, id, 'to everyone');
      const [inTab1, inTab2, inBob] = await events;

      // The sender's own tab gets both the ack and the event; the client merges them.
      expect(inTab1.message.clientMessageId).toBe(ack.ok && ack.data.clientMessageId);
      expect(inTab2.conversation.unreadCount).toBe(0);
      expect(inBob.conversation.unreadCount).toBe(1);
    });

    it('delivers a message sent over REST too', async () => {
      const { a, b, id } = await pair();
      const socketB = await client(b);
      const delivered = nextEvent<MessageNew>(socketB, 'message:new');
      const res = await sendMessage(t.http, a, id, 'via REST').expect(201);
      expect((await delivered).message.id).toBe(res.body.id);
    });

    it('answers a retry with the same message and delivers it again', async () => {
      const { a, b, id } = await pair();
      const [socketA, socketB] = await Promise.all([client(a), client(b)]);
      const received = record<MessageNew>(socketB, 'message:new');
      const clientMessageId = randomUUID();

      const first = await send(socketA, id, 'once', clientMessageId);
      const retry = await send(socketA, id, 'once', clientMessageId);
      await pause(100);

      expect(retry).toEqual(first);
      expect(received.map((e) => e.message.seq)).toEqual([1, 1]);
    });

    it('stores quick sends from one tab in the order they were sent', async () => {
      const { a, id } = await pair();
      const socketA = await client(a);
      const acks = await Promise.all(
        Array.from({ length: 8 }, (_, i) => send(socketA, id, `m${i}`)),
      );
      const stored = acks.map((ack) => (ack.ok ? [ack.data.text, ack.data.seq] : null));
      expect(stored).toEqual(Array.from({ length: 8 }, (_, i) => [`m${i}`, i + 1]));
    });

    it('answers an invalid payload in the ack and keeps the connection', async () => {
      const { a, id } = await pair();
      const socketA = await client(a);

      const ack = await emitWithAck<Ack<never>>(socketA, 'message:send', {
        conversationId: 'nope',
        text: '',
      });
      expect(ack.ok).toBe(false);
      expect(!ack.ok && ack.error).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      const fields = !ack.ok && (ack.error.details as { path: string }[]).map((d) => d.path);
      expect(new Set(fields as string[])).toEqual(
        new Set(['conversationId', 'text', 'clientMessageId']),
      );

      expect(socketA.connected).toBe(true);
      expect((await send(socketA, id, 'still here')).ok).toBe(true);
    });

    it('refuses a conversation the user is not part of, and an unknown one', async () => {
      const { id } = await pair();
      const outsider = await registerUser(t.http, `sock_out${counter}`);
      const socket = await client(outsider);

      const foreign = await send(socket, id, 'let me in');
      expect(!foreign.ok && foreign.error).toMatchObject({ statusCode: 403, error: 'Forbidden' });
      const unknown = await send(socket, new Types.ObjectId().toString(), 'anyone?');
      expect(!unknown.ok && unknown.error.statusCode).toBe(404);
    });

    it('slows down a socket that sends more than 10 messages a second', async () => {
      const { a, id } = await pair();
      const socketA = await client(a);
      const acks = await Promise.all(
        Array.from({ length: 12 }, (_, i) => send(socketA, id, `${i}`)),
      );
      const limited = acks.filter((ack) => !ack.ok && ack.error.statusCode === 429);
      expect(limited.length).toBeGreaterThan(0);
      expect(acks.filter((ack) => ack.ok)).toHaveLength(12 - limited.length);
    });
  });

  describe('conversation:read', () => {
    it('acks the new marker and clears the badge in every tab of the reader only', async () => {
      const { a, b, id } = await pair();
      const [socketA, bobTab1, bobTab2] = await Promise.all([client(a), client(b), client(b)]);
      await send(socketA, id, 'one');
      await send(socketA, id, 'two');
      const readByA = record(socketA, 'conversation:read');
      const inOtherTab = nextEvent(bobTab2, 'conversation:read');

      const ack = await emitWithAck(bobTab1, 'conversation:read', { conversationId: id, seq: 2 });

      expect(ack).toEqual({ ok: true, data: { lastReadSeq: 2, unreadCount: 0 } });
      expect(await inOtherTab).toEqual({ conversationId: id, lastReadSeq: 2, unreadCount: 0 });
      await pause(100);
      expect(readByA).toEqual([]);
    });

    it('answers a bad seq in the ack', async () => {
      const { b, id } = await pair();
      const socketB = await client(b);
      const ack = await emitWithAck<Ack<never>>(socketB, 'conversation:read', {
        conversationId: id,
        seq: -1,
      });
      expect(!ack.ok && ack.error.statusCode).toBe(400);
    });
  });
});
