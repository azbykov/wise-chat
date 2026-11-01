import { io, type Socket } from 'socket.io-client';

/** A connected client, or the rejection the server gave its handshake. */
export function connect(url: string, token?: string): Promise<Socket> {
  const socket = io(url, {
    auth: token === undefined ? {} : { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

/** The next event of that name for which `match` holds, or a failure after `timeoutMs`. */
export function nextEvent<T>(
  socket: Socket,
  event: string,
  match: (payload: T) => boolean = () => true,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`No "${event}" within ${timeoutMs} ms`));
    }, timeoutMs);
    const listener = (payload: T) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

/** Collects every event of that name, for checking that something did not arrive. */
export function record<T>(socket: Socket, event: string): T[] {
  const received: T[] = [];
  socket.on(event, (payload: T) => received.push(payload));
  return received;
}

export function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return socket.timeout(5000).emitWithAck(event, payload) as Promise<T>;
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
