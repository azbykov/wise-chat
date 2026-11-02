import { randomBytes } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000/api';

export interface TestUser {
  email: string;
  username: string;
  password: string;
}

/** A user nobody has seen before: every test brings its own, so tests never depend on each other. */
export function newUser(prefix = 'user'): TestUser {
  const id = randomBytes(4).toString('hex');
  return {
    email: `${prefix}-${id}@example.test`,
    username: `${prefix}_${id}`.slice(0, 24),
    password: 'correct-horse-battery',
  };
}

/** Signs a user up through the API: quicker than the form when sign-up is not what is tested. */
export async function registerViaApi(request: APIRequestContext, user: TestUser) {
  const response = await request.post(`${API_URL}/auth/register`, { data: user });
  expect(response.status(), await response.text()).toBe(201);
}
