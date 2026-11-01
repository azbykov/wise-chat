import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app';
import { connect } from './helpers/sockets';

/** `refresh_token=<value>` from a response's Set-Cookie, or undefined when it sets none. */
function refreshCookie(res: request.Response): string | undefined {
  const header = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
    c.startsWith('refresh_token='),
  );
  return header?.split(';')[0];
}

/** The two halves of `refresh_token=<sessionId>.<secret>`. */
const sessionIdOf = (cookie: string) => cookie.split('=')[1]!.split('.')[0]!;
const secretOf = (cookie: string) => cookie.split('=')[1]!.split('.')[1]!;

describe('sessions', () => {
  let t: TestApp;
  let db: Connection;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await t.close();
  });

  async function signUp() {
    const name = `session_user_${++n}`;
    const res = await request(t.http)
      .post('/api/auth/register')
      .send({ email: `${name}@example.com`, username: name, password: `${name}-password` })
      .expect(201);
    return { res, cookie: refreshCookie(res)!, accessToken: res.body.accessToken as string };
  }

  const refresh = (cookie?: string) =>
    request(t.http)
      .post('/api/auth/refresh')
      .set(cookie ? { Cookie: cookie } : {});

  it('hands out the refresh token as a locked-down cookie, not in the body', async () => {
    const { res, cookie } = await signUp();

    expect(cookie).toMatch(/^refresh_token=[0-9a-f]{24}\./);
    expect(JSON.stringify(res.body)).not.toContain(cookie.split('=')[1]);
    const header = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Strict/);
    expect(header).toMatch(/Path=\/api\/auth/);
    expect(header).toMatch(/Expires=/);
  });

  it('signs in on login with a session of its own', async () => {
    const first = await signUp();
    const login = await request(t.http)
      .post('/api/auth/login')
      .send({ email: `session_user_${n}@example.com`, password: `session_user_${n}-password` })
      .expect(200);
    expect(refreshCookie(login)).toBeDefined();
    expect(refreshCookie(login)).not.toBe(first.cookie);
  });

  it('stores only a hash of the refresh token', async () => {
    const { cookie } = await signUp();
    const secret = secretOf(cookie);
    const stored = await db
      .collection('sessions')
      .findOne({ _id: new Types.ObjectId(sessionIdOf(cookie)) });
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lets the web app send the cookie cross-origin', async () => {
    const res = await request(t.http)
      .options('/api/auth/refresh')
      .set({ Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' })
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  describe('refresh', () => {
    it('rotates the cookie and returns a working access token', async () => {
      const { cookie, accessToken } = await signUp();

      const res = await refresh(cookie).expect(200);
      const next = refreshCookie(res);

      expect(next).toBeDefined();
      expect(next).not.toBe(cookie);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({ username: expect.any(String) });
      await request(t.http)
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${res.body.accessToken}` })
        .expect(200);
      // The old access token is a different one but this is not what is being tested here.
      expect(accessToken).toEqual(expect.any(String));
    });

    it('keeps rotating: the newest cookie always works', async () => {
      let { cookie } = await signUp();
      for (let i = 0; i < 3; i++) {
        const res = await refresh(cookie).expect(200);
        cookie = refreshCookie(res)!;
      }
    });

    it('refuses a request with no cookie, or a made-up one', async () => {
      for (const cookie of [
        undefined,
        'refresh_token=garbage',
        `refresh_token=${'a'.repeat(24)}.x`,
      ]) {
        const res = await refresh(cookie).expect(401);
        expect(res.body.details).toEqual({ code: 'SESSION_INVALID' });
      }
    });

    it('lets a racing tab through once, without a second cookie', async () => {
      const { cookie } = await signUp();

      const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);

      expect([a.status, b.status]).toEqual([200, 200]);
      // Exactly one of the two replaced the token; the loser leaves the browser's cookie alone.
      expect([refreshCookie(a), refreshCookie(b)].filter(Boolean)).toHaveLength(1);
      const winner = refreshCookie(a) ?? refreshCookie(b)!;
      await refresh(winner).expect(200);
    });

    it('ends the session when a replaced token comes back after the grace period', async () => {
      const { cookie } = await signUp();
      const rotated = await refresh(cookie).expect(200);
      const newest = refreshCookie(rotated)!;
      const sessionId = sessionIdOf(cookie);
      await db
        .collection('sessions')
        .updateOne(
          { _id: new Types.ObjectId(sessionId) },
          { $set: { rotatedAt: new Date(Date.now() - 60_000) } },
        );

      const replay = await refresh(cookie).expect(401);
      expect(replay.body.details).toEqual({ code: 'SESSION_REUSED' });
      // The thief's replay also cost the rightful owner the session.
      const after = await refresh(newest).expect(401);
      expect(after.body.details).toEqual({ code: 'SESSION_INVALID' });
      expect(
        await db.collection('sessions').countDocuments({ _id: new Types.ObjectId(sessionId) }),
      ).toBe(0);
    });

    it('clears the cookie it refuses', async () => {
      const res = await refresh('refresh_token=garbage').expect(401);
      expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^refresh_token=;/);
    });

    it('refuses an expired session', async () => {
      const { cookie } = await signUp();
      const sessionId = sessionIdOf(cookie);
      await db
        .collection('sessions')
        .updateOne(
          { _id: new Types.ObjectId(sessionId) },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );
      await refresh(cookie).expect(401);
    });

    it('keeps sessions apart: ending one leaves another signed in', async () => {
      const a = await signUp();
      const login = await request(t.http)
        .post('/api/auth/login')
        .send({ email: `session_user_${n}@example.com`, password: `session_user_${n}-password` })
        .expect(200);
      const b = refreshCookie(login)!;
      await request(t.http).post('/api/auth/logout').set({ Cookie: a.cookie }).expect(204);
      await refresh(b).expect(200);
    });
  });

  describe('logout', () => {
    it('ends the session and clears the cookie', async () => {
      const { cookie } = await signUp();

      const res = await request(t.http)
        .post('/api/auth/logout')
        .set({ Cookie: cookie })
        .expect(204);

      expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^refresh_token=;/);
      await refresh(cookie).expect(401);
    });

    it('works without a cookie, and cannot end a session without its secret', async () => {
      const { cookie } = await signUp();
      await request(t.http).post('/api/auth/logout').expect(204);
      const sessionId = sessionIdOf(cookie);
      await request(t.http)
        .post('/api/auth/logout')
        .set({ Cookie: `refresh_token=${sessionId}.wrong` })
        .expect(204);
      await refresh(cookie).expect(200);
    });

    it('closes the sockets of that session only', async () => {
      const a = await signUp();
      const other = await signUp();
      const socketA = await connect(t.url, a.accessToken);
      const socketOther = await connect(t.url, other.accessToken);
      const closed = new Promise<string>((resolve) => socketA.once('disconnect', resolve));

      await request(t.http).post('/api/auth/logout').set({ Cookie: a.cookie }).expect(204);

      await expect(closed).resolves.toBe('io server disconnect');
      expect(socketOther.connected).toBe(true);
      socketOther.close();
    });

    it('refuses REST calls on the access token of an ended session', async () => {
      const { cookie, accessToken } = await signUp();
      const auth = { Authorization: `Bearer ${accessToken}` };
      await request(t.http).get('/api/conversations').set(auth).expect(200);

      await request(t.http).post('/api/auth/logout').set({ Cookie: cookie }).expect(204);

      await request(t.http).get('/api/conversations').set(auth).expect(401);
    });

    it('refuses a new socket on the access token of an ended session', async () => {
      const { cookie, accessToken } = await signUp();
      await request(t.http).post('/api/auth/logout').set({ Cookie: cookie }).expect(204);

      await expect(connect(t.url, accessToken)).rejects.toMatchObject({
        data: { code: 'UNAUTHORIZED' },
      });
    });

    it('closes the sockets when a replayed token ends the session', async () => {
      const { cookie, accessToken } = await signUp();
      const socket = await connect(t.url, accessToken);
      const closed = new Promise<string>((resolve) => socket.once('disconnect', resolve));
      await refresh(cookie).expect(200);
      const sessionId = sessionIdOf(cookie);
      await db
        .collection('sessions')
        .updateOne(
          { _id: new Types.ObjectId(sessionId) },
          { $set: { rotatedAt: new Date(Date.now() - 60_000) } },
        );

      await refresh(cookie).expect(401);

      await expect(closed).resolves.toBe('io server disconnect');
    });
  });
});
