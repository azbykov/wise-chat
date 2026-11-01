import { describe, expect, it, vi } from 'vitest';
import { ApiError, createHttpClient } from './http';

function respond(status: number, body?: unknown) {
  return vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

describe('http client', () => {
  it('sends JSON with the token and returns the body', async () => {
    const fetch = respond(200, { ok: 1 });
    const http = createHttpClient({ baseUrl: 'http://api.test', fetch });

    const body = await http('/users', { token: 'T', query: { search: 'bo', cursor: undefined } });

    expect(body).toEqual({ ok: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://api.test/api/users?search=bo');
    expect(init.headers).toEqual({ Authorization: 'Bearer T' });
  });

  it('turns an error body into ApiError with field messages', async () => {
    const http = createHttpClient({
      baseUrl: 'http://api.test',
      fetch: respond(409, {
        statusCode: 409,
        error: 'Conflict',
        message: 'This username is taken',
        details: [{ path: 'username', message: 'Already taken' }],
      }),
    });

    const error = await http<never>('/auth/register', { method: 'POST', body: {} }).catch(
      (e: ApiError) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe('This username is taken');
    expect(error.fieldErrors()).toEqual({ username: 'Already taken' });
    expect(error.retryable).toBe(false);
  });

  it('reports a network failure as a retryable error with status 0', async () => {
    const http = createHttpClient({
      baseUrl: 'http://api.test',
      fetch: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    const error = await http('/conversations').catch((e: ApiError) => e);
    expect(error).toMatchObject({ status: 0, retryable: true });
  });

  it('sends FormData as it is', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const http = createHttpClient({ baseUrl: 'http://api.test', fetch });
    const form = new FormData();
    form.set('durationMs', '5000');

    await http('/stories', { method: 'POST', body: form, token: 'T' });
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.body).toBe(form);
    expect(init.headers).toEqual({ Authorization: 'Bearer T' });
  });

  it('signs out on a 401 to an authenticated request only', async () => {
    const onUnauthorized = vi.fn();
    const http = createHttpClient({
      baseUrl: 'http://api.test',
      fetch: respond(401, { message: 'Invalid email or password' }),
      onUnauthorized,
    });

    await http('/auth/login', { method: 'POST', body: {} }).catch(() => {});
    expect(onUnauthorized).not.toHaveBeenCalled();

    await http('/conversations', { token: 'stale' }).catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  describe('an expired access token', () => {
    /** 401 for the stale token, 200 for the fresh one. */
    const expiring = () =>
      vi.fn(async (_url: URL | string | Request, init?: RequestInit) => {
        const bearer = (init?.headers as Record<string, string>).Authorization;
        return bearer === 'Bearer fresh'
          ? new Response(JSON.stringify({ ok: true }), { status: 200 })
          : new Response(JSON.stringify({ message: 'Access token expired' }), { status: 401 });
      });

    it('is replaced and the request repeated once, transparently', async () => {
      const fetch = expiring();
      const refresh = vi.fn(async () => 'fresh');
      const onUnauthorized = vi.fn();
      const http = createHttpClient({ baseUrl: 'http://api.test', fetch, refresh, onUnauthorized });

      expect(await http('/conversations', { token: 'stale' })).toEqual({ ok: true });
      expect(refresh).toHaveBeenCalledWith('stale');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it('signs out when there is no session left to refresh', async () => {
      const onUnauthorized = vi.fn();
      const http = createHttpClient({
        baseUrl: 'http://api.test',
        fetch: expiring(),
        refresh: async () => null,
        onUnauthorized,
      });

      await expect(http('/conversations', { token: 'stale' })).rejects.toMatchObject({
        status: 401,
      });
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });

    it('does not refresh again when the new token is refused too', async () => {
      const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
      const refresh = vi.fn(async () => 'fresh');
      const onUnauthorized = vi.fn();
      const http = createHttpClient({ baseUrl: 'http://api.test', fetch, refresh, onUnauthorized });

      await http('/conversations', { token: 'stale' }).catch(() => {});
      expect(refresh).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });

    it('is not tried for requests without a token', async () => {
      const refresh = vi.fn(async () => 'fresh');
      const http = createHttpClient({
        baseUrl: 'http://api.test',
        fetch: expiring(),
        refresh,
      });

      await http('/auth/refresh', { method: 'POST' }).catch(() => {});
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  it('sends cookies, for the refresh token', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    await createHttpClient({ baseUrl: 'http://api.test', fetch })('/auth/refresh', {
      method: 'POST',
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
