import { derived, get, writable, type Readable } from 'svelte/store';
import type { HttpClient } from '../api/http';
import type { AuthResponse, MeDto } from '../api/types';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: MeDto | null;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface Registration extends Credentials {
  username: string;
}

export interface AuthStore extends Readable<AuthState> {
  /** Reads the refresh cookie and returns whether the user is signed in. */
  init(): Promise<AuthStatus>;
  login(input: Credentials): Promise<MeDto>;
  register(input: Registration): Promise<MeDto>;
  /** Forgets the session here at once and ends it on the server in the background. */
  logout(): void;
  /** The access token, as it is now; it may be about to expire. */
  token(): string | null;
  /** A token good for at least a little while, refreshed first if it is not. Null: signed out. */
  freshToken(): Promise<string | null>;
  /**
   * A new access token after the server rejected `rejectedToken`. If another request already got
   * one, that is returned without asking the server again. Null: the session is over.
   */
  renew(rejectedToken: string): Promise<string | null>;
}

/** Runs `task` with nothing else in any tab of the app refreshing; see browserLock. */
export type Lock = <T>(task: () => Promise<T>) => Promise<T>;

/** A token this close to expiring is replaced before it is used. */
const EXPIRY_MARGIN_MS = 30_000;

/** When a JWT stops working, in ms since the epoch; 0 if it cannot be read. */
export function tokenExpiresAt(token: string): number {
  try {
    const payload = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload)) as { exp?: unknown };
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Tabs share one refresh cookie, and each refresh replaces it. One refresh at a time across all
 * tabs means a tab always sends the newest cookie. (The server forgives a tab that loses the
 * race anyway; this keeps that for the rare case, and for browsers without Web Locks.)
 */
export const browserLock: Lock = (task) =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('chat.refresh', task)
    : task();

export function createAuthStore(deps: { http: HttpClient; lock?: Lock }): AuthStore {
  const lock = deps.lock ?? ((task) => task());
  const state = writable<AuthState>({ status: 'unknown', user: null });
  // Memory only: a script on the page cannot read it back after a reload, and a reload gets a
  // new one from the cookie, which scripts cannot read either.
  let accessToken: string | null = null;
  let refreshing: Promise<string | null> | null = null;
  let initializing: Promise<AuthStatus> | null = null;

  function apply(response: AuthResponse): MeDto {
    accessToken = response.accessToken;
    state.set({ status: 'authenticated', user: response.user });
    return response.user;
  }

  function clear() {
    accessToken = null;
    state.set({ status: 'anonymous', user: null });
  }

  /** One refresh at a time in this tab; callers arriving meanwhile share its result. */
  function refresh(): Promise<string | null> {
    refreshing ??= lock(() => deps.http<AuthResponse>('/auth/refresh', { method: 'POST' }))
      .then((response) => {
        apply(response);
        return response.accessToken;
      })
      .catch((error: unknown) => {
        // Only a refused cookie ends the session; a network error leaves it for a later try.
        if ((error as { status?: number }).status === 401) {
          clear();
          return null;
        }
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  return {
    subscribe: state.subscribe,
    init() {
      const { status } = get(state);
      if (status !== 'unknown') return Promise.resolve(status);
      initializing ??= refresh()
        .then((token): AuthStatus => (token ? 'authenticated' : 'anonymous'))
        .finally(() => {
          initializing = null;
        });
      return initializing;
    },
    async login(input) {
      return apply(await deps.http<AuthResponse>('/auth/login', { method: 'POST', body: input }));
    },
    async register(input) {
      return apply(
        await deps.http<AuthResponse>('/auth/register', { method: 'POST', body: input }),
      );
    },
    logout() {
      clear();
      // Best effort: the cookie is cleared by the answer; if this never arrives, the session
      // simply lives out its time on the server.
      void deps.http('/auth/logout', { method: 'POST' }).catch(() => {});
    },
    token: () => accessToken,
    async freshToken() {
      if (accessToken && tokenExpiresAt(accessToken) - Date.now() > EXPIRY_MARGIN_MS) {
        return accessToken;
      }
      return refresh();
    },
    async renew(rejectedToken) {
      if (accessToken && accessToken !== rejectedToken) return accessToken;
      return refresh();
    },
  };
}

export function currentUserOf(auth: AuthStore): Readable<MeDto | null> {
  return derived(auth, ($auth) => $auth.user);
}
