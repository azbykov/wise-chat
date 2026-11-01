import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app';
import { registerUser, type TestUser } from './helpers/users';

describe('users', () => {
  let t: TestApp;
  let viewer: TestUser;
  const others = ['Anna', 'anton', 'Boris', 'bella', 'carl', 'a.dot', 'a_under', 'Robert'];
  // Alphabetical without regard to case, as usernameLower sorts them.
  const sorted = ['a.dot', 'a_under', 'Anna', 'anton', 'bella', 'Boris', 'carl', 'Robert'];

  beforeAll(async () => {
    t = await createTestApp();
    [viewer] = await Promise.all([
      registerUser(t.http, 'viewer'),
      ...others.map((name) => registerUser(t.http, name)),
    ]);
  });

  afterAll(async () => {
    await t.close();
  });

  const list = (query: Record<string, string | number> = {}) =>
    request(t.http).get('/api/users').query(query).set(viewer.auth);
  const names = (body: { items: { username: string }[] }) => body.items.map((u) => u.username);

  it('lists everyone but the viewer, alphabetically', async () => {
    const res = await list().expect(200);
    expect(names(res.body)).toEqual(sorted);
    expect(res.body.nextCursor).toBeNull();
  });

  it('shows only public fields, never an email', async () => {
    const res = await list().expect(200);
    for (const user of res.body.items) {
      expect(Object.keys(user).sort()).toEqual(['createdAt', 'id', 'username']);
    }
  });

  it('pages through everyone without gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await list({ limit: 3, ...(cursor ? { cursor } : {}) }).expect(
        200,
      );
      expect(res.body.items.length).toBeLessThanOrEqual(3);
      seen.push(...names(res.body));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(sorted);
  });

  it('finds a part of the username in any case', async () => {
    expect(names((await list({ search: 'OB' }).expect(200)).body)).toEqual(['Robert']);
    expect(names((await list({ search: 'an' }).expect(200)).body)).toEqual(['Anna', 'anton']);
  });

  it('pages through search results too', async () => {
    const first = await list({ search: 'a', limit: 2 }).expect(200);
    const second = await list({ search: 'a', limit: 2, cursor: first.body.nextCursor }).expect(200);
    expect([...names(first.body), ...names(second.body)]).toEqual([
      'a.dot',
      'a_under',
      'Anna',
      'anton',
    ]);
  });

  it('searches for regex characters literally', async () => {
    expect(names((await list({ search: 'a.' }).expect(200)).body)).toEqual(['a.dot']);
    expect((await list({ search: '.*' }).expect(200)).body.items).toEqual([]);
  });

  it('treats a blank search as no search', async () => {
    expect(names((await list({ search: '   ' }).expect(200)).body)).toEqual(sorted);
  });

  it('never finds the viewer', async () => {
    expect((await list({ search: 'viewer' }).expect(200)).body.items).toEqual([]);
  });

  it.each([
    ['limit 0', { limit: 0 }],
    ['limit 51', { limit: 51 }],
    ['a broken cursor', { cursor: 'Not A Cursor' }],
    ['a search that is too long', { search: 'x'.repeat(25) }],
    ['control characters in search', { search: 'a\u0007b' }],
  ])('answers 400 to %s', async (_case, query) => {
    const res = await list(query).expect(400);
    expect(res.body.statusCode).toBe(400);
  });
});
