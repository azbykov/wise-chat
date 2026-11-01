import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app';

describe('request id and security headers', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('puts the same generated id in the header and the error body', async () => {
    const res = await request(t.http).get('/api/nope').expect(404);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('keeps a sane id from the caller', async () => {
    const res = await request(t.http).get('/api/nope').set('X-Request-Id', 'abc-123').expect(404);
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.body.requestId).toBe('abc-123');
  });

  it('replaces an id that is not a plain token', async () => {
    const res = await request(t.http)
      .get('/api/nope')
      .set('X-Request-Id', 'a b<script>')
      .expect(404);
    expect(res.headers['x-request-id']).not.toContain('<');
  });

  it('sends security headers and hides Express', async () => {
    const res = await request(t.http).get('/api/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
