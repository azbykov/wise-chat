export default async function globalTeardown(): Promise<void> {
  await globalThis.__MONGO_REPL_SET__?.stop();
}
