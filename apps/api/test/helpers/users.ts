import request from 'supertest';
import type { App } from 'supertest/types';

export interface TestUser {
  id: string;
  username: string;
  email: string;
  password: string;
  token: string;
  auth: { Authorization: string };
}

export async function registerUser(http: App, username: string): Promise<TestUser> {
  const email = `${username.toLowerCase()}@example.com`;
  const password = `${username}-password`;
  const res = await request(http)
    .post('/api/auth/register')
    .send({ email, username, password })
    .expect(201);
  const token: string = res.body.accessToken;
  return {
    id: res.body.user.id,
    username,
    email,
    password,
    token,
    auth: { Authorization: `Bearer ${token}` },
  };
}
