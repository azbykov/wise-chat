import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type HttpClient } from '../api/http';
import { createAuthStore, tokenExpiresAt } from './auth';

const user = { id: 'u1', username: 'alice', email: 'alice@example.com', createdAt: '2026-01-01' };

/** An unsigned JWT that expires `inMs` from now; the store only reads its `exp`. */
function jwt(inMs: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor((Date.now() + inMs) / 1000) }));
  return `h.${payload}.s`;
}

const answering = (...answers: (object | Error)[]) =>
  vi.fn(async () => {
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as HttpClient;

describe('auth store', () => {
  it('is anonymous when the server has no session for the cookie', async () => {
    const http = answering(new ApiError(401, 'Invalid session'));
    const auth = createAuthStore({ http });

    expect(await auth.init()).toBe('anonymous');
    expect(http).toHaveBeenCalledWith('/auth/refresh', { method: 'POST' });
    expect(get(auth)).toEqual({ status: 'anonymous', user: null });
  });

  it('restores the session from the cookie, keeping the token in memory', async () => {
    const auth = createAuthStore({ http: answering({ accessToken: 'T', user }) });

    expect(await auth.init()).toBe('authenticated');
    expect(get(auth).user).toEqual(user);
    expect(auth.token()).toBe('T');
  });

  it('asks the server once however many callers init', async () => {
    const http = answering({ accessToken: 'T', user });
    const auth = createAuthStore({ http });

    await Promise.all([auth.init(), auth.init()]);
    await auth.init();
    expect(http).toHaveBeenCalledOnce();
  });

  it('stays undecided when the server cannot be reached', async () => {
    const auth = createAuthStore({ http: answering(ApiError.network()) });

    await expect(auth.init()).rejects.toMatchObject({ status: 0 });
    expect(get(auth).status).toBe('unknown');
  });

  it('keeps the token in memory on login and drops it on logout', async () => {
    const http = answering({ accessToken: 'NEW', user }, {});
    const auth = createAuthStore({ http });

    await auth.login({ email: user.email, password: 'secret-password' });
    expect(auth.token()).toBe('NEW');
    expect(get(auth).status).toBe('authenticated');

    auth.logout();
    expect(auth.token()).toBeNull();
    expect(get(auth)).toEqual({ status: 'anonymous', user: null });
    expect(http).toHaveBeenLastCalledWith('/auth/logout', { method: 'POST' });
  });

  it('signs out locally even when the server cannot be told', async () => {
    const auth = createAuthStore({
      http: answering({ accessToken: 'T', user }, ApiError.network()),
    });
    await auth.init();

    auth.logout();
    await Promise.resolve();
    expect(get(auth).status).toBe('anonymous');
  });

  describe('refreshing', () => {
    it('keeps a token that is good for a while', async () => {
      const token = jwt(10 * 60_000);
      const http = answering({ accessToken: token, user });
      const auth = createAuthStore({ http });
      await auth.init();

      expect(await auth.freshToken()).toBe(token);
      expect(http).toHaveBeenCalledOnce();
    });

    it('replaces a token that is about to expire', async () => {
      const fresh = jwt(15 * 60_000);
      const http = answering({ accessToken: jwt(5_000), user }, { accessToken: fresh, user });
      const auth = createAuthStore({ http });
      await auth.init();

      expect(await auth.freshToken()).toBe(fresh);
      expect(auth.token()).toBe(fresh);
    });

    it('shares one refresh between callers that arrive together', async () => {
      const http = answering({ accessToken: 'A', user }, { accessToken: 'B', user });
      const auth = createAuthStore({ http });
      await auth.init();

      const tokens = await Promise.all([auth.renew('A'), auth.renew('A'), auth.renew('A')]);
      expect(tokens).toEqual(['B', 'B', 'B']);
      expect(http).toHaveBeenCalledTimes(2);
    });

    it('does not refresh for a token that another request already replaced', async () => {
      const http = answering({ accessToken: 'A', user }, { accessToken: 'B', user });
      const auth = createAuthStore({ http });
      await auth.init();
      await auth.renew('A');

      expect(await auth.renew('A')).toBe('B');
      expect(http).toHaveBeenCalledTimes(2);
    });

    it('runs the refresh inside the lock', async () => {
      const order: string[] = [];
      const lock = async <T>(task: () => Promise<T>) => {
        order.push('lock');
        return task();
      };
      const http = vi.fn(async () => {
        order.push('request');
        return { accessToken: 'T', user };
      }) as unknown as HttpClient;

      await createAuthStore({ http, lock }).init();
      expect(order).toEqual(['lock', 'request']);
    });

    it('signs out when the cookie is refused', async () => {
      const auth = createAuthStore({
        http: answering({ accessToken: 'A', user }, new ApiError(401, 'Session ended')),
      });
      await auth.init();

      expect(await auth.renew('A')).toBeNull();
      expect(get(auth).status).toBe('anonymous');
      expect(auth.token()).toBeNull();
    });

    it('keeps the session when the refresh fails for lack of network', async () => {
      const auth = createAuthStore({
        http: answering({ accessToken: 'A', user }, ApiError.network()),
      });
      await auth.init();

      await expect(auth.renew('A')).rejects.toMatchObject({ status: 0 });
      expect(get(auth).status).toBe('authenticated');
      expect(auth.token()).toBe('A');
    });
  });
});

describe('tokenExpiresAt', () => {
  it('reads exp from the payload', () => {
    expect(tokenExpiresAt(`h.${btoa('{"exp":1000}')}.s`)).toBe(1_000_000);
  });

  it('is 0 for anything that is not a token', () => {
    expect(tokenExpiresAt('nope')).toBe(0);
    expect(tokenExpiresAt('a.b.c')).toBe(0);
  });
});
