import { MongoMemoryReplSet } from 'mongodb-memory-server';

declare global {
  var __MONGO_REPL_SET__: MongoMemoryReplSet | undefined;
}

/**
 * One single-node replica set for the whole run: transactions need a replica set. Set
 * MONGO_TEST_URI to run against an existing one instead (`pnpm db:up`, no download needed).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.MONGO_TEST_URI) {
    return;
  }
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  globalThis.__MONGO_REPL_SET__ = replSet;
  // Test workers start after this and inherit the variable.
  process.env.MONGO_TEST_URI = replSet.getUri();
}
