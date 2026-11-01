import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { Env } from '../config/env';
import type { ByteRange } from './range';

/** Where story videos live. Local disk here; S3 would be a second implementation. */
export abstract class StoryStorage {
  /** Takes over the file at `sourcePath`: afterwards it is stored as `fileName` and the source is gone. */
  abstract save(fileName: string, sourcePath: string): Promise<void>;
  /** Removes received files older than `olderThanMs` that nobody took over (a crash mid-upload). */
  abstract deleteStaleIncoming(olderThanMs: number): Promise<number>;
  /** The whole file, or the inclusive byte range of it. */
  abstract open(fileName: string, range?: ByteRange): ReadStream;
  /** Idempotent: a file that is already gone is not an error. */
  abstract delete(fileName: string): Promise<void>;
}

/**
 * Where uploads are received, before `save` takes them over: inside the storage directory, so
 * taking over is a rename, not a copy. Never served, swept when stale.
 */
export function incomingDir(config: ConfigService<Env, true>): string {
  return join(resolve(config.get('UPLOADS_DIR', { infer: true })), '.incoming');
}

@Injectable()
export class LocalDiskStoryStorage extends StoryStorage implements OnModuleInit {
  private readonly dir: string;
  private readonly incoming: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.dir = resolve(config.get('UPLOADS_DIR', { infer: true }));
    this.incoming = incomingDir(config);
  }

  async onModuleInit() {
    await mkdir(this.incoming, { recursive: true });
  }

  async save(fileName: string, sourcePath: string): Promise<void> {
    await rename(sourcePath, this.path(fileName));
  }

  async deleteStaleIncoming(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const name of await readdir(this.incoming).catch(() => [])) {
      const path = join(this.incoming, name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && info.mtimeMs < cutoff) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  open(fileName: string, range?: ByteRange): ReadStream {
    return createReadStream(this.path(fileName), range);
  }

  async delete(fileName: string): Promise<void> {
    await rm(this.path(fileName), { force: true });
  }

  /** Names come from our own documents, but a path never leaves the directory anyway. */
  private path(fileName: string): string {
    return join(this.dir, basename(fileName));
  }
}
