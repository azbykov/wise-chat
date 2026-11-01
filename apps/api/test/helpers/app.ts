import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import type { Server } from 'node:http';
import { rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export interface TestApp {
  app: INestApplication<App>;
  http: App;
  /** Base URL of the listening server, for socket clients. */
  url: string;
  close(): Promise<void>;
}

/**
 * The real app, configured as main.ts does, on this test file's database (dropped on close).
 * It listens on a free port, so socket clients can connect to it.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as unknown as Server).address() as AddressInfo;

  return {
    app,
    http: app.getHttpServer(),
    url: `http://127.0.0.1:${port}`,
    async close() {
      await app.get<Connection>(getConnectionToken()).dropDatabase();
      await app.close();
      await rm(process.env.UPLOADS_DIR!, { recursive: true, force: true });
    },
  };
}
