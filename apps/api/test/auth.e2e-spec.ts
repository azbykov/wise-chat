import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app';
import { registerUser } from './helpers/users';

describe('auth', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('register', () => {
    it('creates the account and signs in', async () => {
      const res = await request(t.http)
        .post('/api/auth/register')
        .send({ email: '  Alice@Example.COM ', username: ' Alice ', password: 'alice-password' })
        .expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toEqual({
        id: expect.any(String),
        username: 'Alice',
        email: 'alice@example.com',
        createdAt: expect.any(String),
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('refuses a taken email, whatever its case', async () => {
      await registerUser(t.http, 'carol');
      const res = await request(t.http)
        .post('/api/auth/register')
        .send({ email: 'CAROL@example.com', username: 'carol2', password: 'carol-password' })
        .expect(409);
      expect(res.body).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        details: [{ path: 'email', message: 'Already registered' }],
      });
    });

    it('refuses a username that differs only in case', async () => {
      await registerUser(t.http, 'bob');
      const res = await request(t.http)
        .post('/api/auth/register')
        .send({ email: 'other-bob@example.com', username: 'Bob', password: 'bob-password' })
        .expect(409);
      expect(res.body.details).toEqual([{ path: 'username', message: 'Already taken' }]);
    });

    it('keeps one account when the same username races in twice', async () => {
      const attempt = (n: number) =>
        request(t.http)
          .post('/api/auth/register')
          .send({ email: `race${n}@example.com`, username: 'racer', password: 'race-password' });
      const statuses = (await Promise.all([1, 2, 3, 4, 5].map(attempt))).map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    });

    it('names every invalid field', async () => {
      const res = await request(t.http)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', username: 'no spaces!', password: 'short' })
        .expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      const paths = (res.body.details as { path: string }[]).map((d) => d.path);
      expect(new Set(paths)).toEqual(new Set(['email', 'username', 'password']));
    });

    it.each([
      ['too short', 'ab'],
      ['too long', 'a'.repeat(25)],
      ['Cyrillic', 'алиса'],
      ['a space', 'a b'],
    ])('refuses a username that is %s', async (_case, username) => {
      await request(t.http)
        .post('/api/auth/register')
        .send({ email: `${Date.now()}@example.com`, username, password: 'long-enough' })
        .expect(400);
    });

    it('refuses unknown fields', async () => {
      await request(t.http)
        .post('/api/auth/register')
        .send({ email: 'x@example.com', username: 'xavier', password: 'long-enough', admin: true })
        .expect(400);
    });
  });

  describe('login', () => {
    it('signs in with the right password, the email in any case', async () => {
      const dave = await registerUser(t.http, 'dave');
      const res = await request(t.http)
        .post('/api/auth/login')
        .send({ email: 'DAVE@example.com', password: dave.password })
        .expect(200);
      expect(res.body.user.id).toBe(dave.id);
    });

    it('answers a wrong password and an unknown email the same way', async () => {
      const erin = await registerUser(t.http, 'erin');
      const wrong = await request(t.http)
        .post('/api/auth/login')
        .send({ email: erin.email, password: 'wrong-password' })
        .expect(401);
      const unknown = await request(t.http)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' })
        .expect(401);
      const { requestId: _a, ...wrongBody } = wrong.body;
      const { requestId: _b, ...unknownBody } = unknown.body;
      expect(wrongBody).toEqual(unknownBody);
      expect(wrong.body.message).toBe('Invalid email or password');
    });
  });

  describe('me and protected routes', () => {
    it('returns the signed-in user', async () => {
      const frank = await registerUser(t.http, 'frank');
      const res = await request(t.http).get('/api/auth/me').set(frank.auth).expect(200);
      expect(res.body).toMatchObject({ id: frank.id, username: 'frank', email: frank.email });
    });

    it.each([
      ['no header', {}],
      ['another scheme', { Authorization: 'Basic abc' }],
      ['a forged token', { Authorization: 'Bearer not.a.jwt' }],
    ])('answers 401 with %s', async (_case, headers) => {
      for (const path of ['/api/auth/me', '/api/users']) {
        const res = await request(t.http).get(path).set(headers).expect(401);
        expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
      }
    });

    it('tells an expired token apart', async () => {
      const grace = await registerUser(t.http, 'grace');
      const expired = await t.app
        .get(JwtService)
        .signAsync({ username: 'grace' }, { subject: grace.id, expiresIn: -10 });
      const res = await request(t.http)
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${expired}` })
        .expect(401);
      expect(res.body.details).toEqual({ code: 'TOKEN_EXPIRED' });
    });

    it('keeps the health check open', async () => {
      await request(t.http).get('/api/health').expect(200);
    });
  });
});
