import './setup/strict-rate-limit';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app';
import { registerUser } from './helpers/users';

describe('auth rate limit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('stops the 11th sign-in within a minute, but never /auth/me', async () => {
    const user = await registerUser(t.http, 'limited');
    const login = () =>
      request(t.http).post('/api/auth/login').send({ email: user.email, password: user.password });

    for (let i = 0; i < 10; i++) {
      await login().expect(200);
    }
    const blocked = await login().expect(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });

    for (let i = 0; i < 15; i++) {
      await request(t.http).get('/api/auth/me').set(user.auth).expect(200);
    }
  });
});
