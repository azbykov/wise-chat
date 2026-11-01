import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { TestUser } from './users';

export async function openConversation(http: App, user: TestUser, peer: TestUser): Promise<string> {
  const res = await request(http)
    .post('/api/conversations')
    .set(user.auth)
    .send({ userId: peer.id });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`open conversation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id;
}

export function sendMessage(
  http: App,
  user: TestUser,
  conversationId: string,
  text: string,
  clientMessageId: string = randomUUID(),
) {
  return request(http)
    .post(`/api/conversations/${conversationId}/messages`)
    .set(user.auth)
    .send({ text, clientMessageId });
}
