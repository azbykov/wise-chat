import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO with the API's CORS origin, read from the config at startup rather than fixed in the
 * gateway decorator. One message of an event per socket at a time: two quick message:send from
 * one tab are stored in the order they were sent, not in the order their transactions commit.
 */
export class ChatIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigin: string,
  ) {
    super(app, { maxConcurrentMessages: 1 });
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin },
    } as ServerOptions);
  }
}
