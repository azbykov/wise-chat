import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app';

describe('health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('reports MongoDB as up', async () => {
    const res = await request(t.http).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', mongo: 'up' });
  });

  it('runs on a replica set, so transactions work', async () => {
    const connection = t.app.get<Connection>(getConnectionToken());
    const items = connection.collection('smoke');
    await connection.createCollection('smoke');

    await connection.transaction(async (session) => {
      await items.insertOne({ n: 1 }, { session });
    });
    await expect(
      connection.transaction(async (session) => {
        await items.insertOne({ n: 2 }, { session });
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');

    expect(await items.countDocuments()).toBe(1);
  });

  it('answers 404 outside the API prefix', async () => {
    await request(t.http).get('/health').expect(404);
  });
});
