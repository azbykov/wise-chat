import { io, type Socket } from 'socket.io-client';
import { writable, type Readable } from 'svelte/store';
import { ApiError } from '../api/http';

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline';

type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { statusCode: number; message: string; details?: unknown } };

export interface SocketClient {
  /** `idle` before sign-in, then connecting / online / offline: what the banner shows. */
  status: Readable<ConnectionStatus>;
  /** `getToken` is asked for a token at every (re)connect, so a long-lived socket never presents a stale one. */
  connect(getToken: () => Promise<string | null>): void;
  disconnect(): void;
  /** Sends an event and waits for its ack; ApiError for a refusal, status 0 for no answer. */
  request<T>(event: string, payload: unknown): Promise<T>;
  on<T>(event: string, handler: (payload: T) => void): () => void;
  /** Runs after every successful (re)connect: the place to catch up on what was missed. */
  onConnect(handler: () => void): () => void;
}

const ACK_TIMEOUT_MS = 5000;
const RETRY_MS = 3000;

export function createSocketClient(deps: {
  url: string;
  /** The handshake was refused for the token: the session is over. */
  onUnauthorized: () => void;
}): SocketClient {
  const status = writable<ConnectionStatus>('idle');
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const connectHandlers = new Set<() => void>();
  let socket: Socket | null = null;

  function bind(target: Socket, event: string) {
    target.on(event, (payload: unknown) => handlers.get(event)?.forEach((h) => h(payload)));
  }

  return {
    status: { subscribe: status.subscribe },
    connect(getToken) {
      socket?.close();
      status.set('connecting');
      const current = io(deps.url, {
        // An empty token is refused as unauthorized, which signs the user out: right when the
        // session is over (no token), and the failure to get one is handled by getToken.
        auth: (callback) => {
          getToken().then(
            (token) => callback({ token: token ?? '' }),
            () => callback({ token: '' }),
          );
        },
        transports: ['websocket'],
      });
      socket = current;
      for (const event of handlers.keys()) bind(current, event);

      current.on('connect', () => {
        status.set('online');
        connectHandlers.forEach((h) => h());
      });
      current.on('disconnect', (reason) => {
        status.set('offline');
        // The server closed it: the access token ran out. Socket.IO does not retry that on its
        // own; connecting again asks getToken for a new token.
        if (reason === 'io server disconnect') current.connect();
      });
      current.on('connect_error', (error: Error & { data?: { code?: string } }) => {
        const code = error.data?.code;
        // TOKEN_EXPIRED: a new token could not be fetched (the network is down). UNAVAILABLE: the
        // server could not check the session. Neither ends it; a refused handshake is not retried
        // by Socket.IO, so retry here.
        if (code === 'TOKEN_EXPIRED' || code === 'UNAVAILABLE') {
          status.set('offline');
          setTimeout(() => current.active || current.connect(), RETRY_MS);
          return;
        }
        if (code === 'UNAUTHORIZED') {
          current.close();
          status.set('idle');
          deps.onUnauthorized();
          return;
        }
        // Server down or network gone: Socket.IO keeps retrying on its own.
        status.set('offline');
      });
    },
    disconnect() {
      socket?.close();
      socket = null;
      status.set('idle');
    },
    async request<T>(event: string, payload: unknown): Promise<T> {
      if (!socket?.connected) throw ApiError.network();
      let ack: Ack<T>;
      try {
        ack = (await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload)) as Ack<T>;
      } catch {
        throw ApiError.network();
      }
      if (!ack.ok) {
        throw new ApiError(ack.error.statusCode, ack.error.message, ack.error.details);
      }
      return ack.data;
    },
    on<T>(event: string, handler: (payload: T) => void) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
        if (socket) bind(socket, event);
      }
      const h = handler as (payload: unknown) => void;
      set.add(h);
      return () => set.delete(h);
    },
    onConnect(handler) {
      connectHandlers.add(handler);
      return () => connectHandlers.delete(handler);
    },
  };
}
