import { Types } from 'mongoose';
import request from 'supertest';
import { openConversation, sendMessage } from './helpers/conversations';
import { createTestApp, type TestApp } from './helpers/app';
import { registerUser, type TestUser } from './helpers/users';

describe('conversations', () => {
  let t: TestApp;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

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

  const open = (user: TestUser, peer: TestUser | { id: string }) =>
    request(t.http).post('/api/conversations').set(user.auth).send({ userId: peer.id });
  const list = async (user: TestUser) =>
    (await request(t.http).get('/api/conversations').set(user.auth).expect(200)).body as {
      id: string;
      peer: { id: string };
    }[];

  it('creates the conversation once, then returns the same one to both sides', async () => {
    const first = await open(alice, bob).expect(201);
    const again = await open(alice, bob).expect(200);
    const fromBob = await open(bob, alice).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(fromBob.body.id).toBe(first.body.id);
  });

  it('shows each side the other as the peer', async () => {
    const fromAlice = await open(alice, carol).expect(201);
    const fromCarol = await open(carol, alice).expect(200);
    expect(fromAlice.body).toMatchObject({
      peer: { id: carol.id, username: 'carol' },
      lastMessage: null,
      unreadCount: 0,
    });
    expect(fromCarol.body.peer.id).toBe(alice.id);
    expect(Object.keys(fromAlice.body.peer).sort()).toEqual(['createdAt', 'id', 'username']);
  });

  it('ends up with one conversation when both sides open it at the same time', async () => {
    const [dave, erin] = await Promise.all([
      registerUser(t.http, 'dave'),
      registerUser(t.http, 'erin'),
    ]);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? open(dave, erin) : open(erin, dave))),
    );
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(19);
  });

  it('refuses a conversation with yourself or with nobody', async () => {
    await open(alice, alice).expect(400);
    await open(alice, { id: new Types.ObjectId().toString() }).expect(404);
    await open(alice, { id: 'not-an-id' }).expect(400);
  });

  it('lists an empty conversation only to those who opened it', async () => {
    const [frank, grace] = await Promise.all([
      registerUser(t.http, 'frank'),
      registerUser(t.http, 'grace'),
    ]);
    const id = await openConversation(t.http, frank, grace);
    expect((await list(frank)).map((c) => c.id)).toEqual([id]);
    expect(await list(grace)).toEqual([]);

    // Grace opens the conversation Frank created: now she sees it too.
    await openConversation(t.http, grace, frank);
    expect((await list(grace)).map((c) => c.id)).toEqual([id]);
  });

  it('lists a conversation to the peer as soon as it has a message', async () => {
    const [heidi, ivan] = await Promise.all([
      registerUser(t.http, 'heidi'),
      registerUser(t.http, 'ivan'),
    ]);
    const id = await openConversation(t.http, heidi, ivan);
    await sendMessage(t.http, heidi, id, 'hi').expect(201);
    expect((await list(ivan)).map((c) => c.id)).toEqual([id]);
  });

  it('puts the most recently active conversation first', async () => {
    const [judy, ken, leo] = await Promise.all([
      registerUser(t.http, 'judy'),
      registerUser(t.http, 'ken'),
      registerUser(t.http, 'leo'),
    ]);
    const withKen = await openConversation(t.http, judy, ken);
    const withLeo = await openConversation(t.http, judy, leo);
    // Just opened: the newer one is first.
    expect((await list(judy)).map((c) => c.id)).toEqual([withLeo, withKen]);

    await sendMessage(t.http, judy, withKen, 'news').expect(201);
    expect((await list(judy)).map((c) => c.id)).toEqual([withKen, withLeo]);
  });

  it('shows one conversation to its participants only', async () => {
    const id = await openConversation(t.http, alice, bob);
    await request(t.http).get(`/api/conversations/${id}`).set(bob.auth).expect(200);
    const outsider = await request(t.http).get(`/api/conversations/${id}`).set(carol.auth);
    expect(outsider.status).toBe(403);
    expect(outsider.body.error).toBe('Forbidden');
    await request(t.http)
      .get(`/api/conversations/${new Types.ObjectId().toString()}`)
      .set(alice.auth)
      .expect(404);
    await request(t.http).get('/api/conversations/not-an-id').set(alice.auth).expect(400);
  });
});
