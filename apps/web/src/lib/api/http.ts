import type { FieldError } from './types';

/** The API's error shape, from REST and from socket acks alike. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Messages per field, for forms: { email: 'Already registered' }. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const fields: Record<string, string> = {};
    for (const item of this.details as FieldError[]) {
      if (item && typeof item.path === 'string' && !(item.path in fields)) {
        fields[item.path] = item.message;
      }
    }
    return fields;
  }

  /** Worth retrying: the request never got an answer, or the server was busy or broken. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  get code(): string | undefined {
    const details = this.details as { code?: unknown } | undefined;
    return typeof details?.code === 'string' ? details.code : undefined;
  }

  static fromBody(status: number, body: unknown): ApiError {
    const data = (body ?? {}) as { message?: unknown; details?: unknown };
    const message = typeof data.message === 'string' ? data.message : `Request failed (${status})`;
    return new ApiError(status, message, data.details);
  }

  static network(): ApiError {
    return new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  /** JSON, or FormData sent as multipart/form-data. */
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  token?: string | null;
}

export interface HttpClient {
  <T>(path: string, options?: RequestOptions): Promise<T>;
}

/**
 * fetch with the API's base URL, JSON in and out, and ApiError for every failure. A 401 to an
 * authenticated request means the access token ran out: `refresh` gets a new one (given the
 * rejected one) and the request is repeated once. Without a new token the session is gone, and
 * `onUnauthorized` runs: the app signs out.
 */
export function createHttpClient(deps: {
  baseUrl: string;
  fetch?: typeof fetch;
  refresh?: (rejectedToken: string) => Promise<string | null>;
  onUnauthorized?: () => void;
}): HttpClient {
  const doFetch = deps.fetch ?? ((...args) => fetch(...args));
  const send = async <T>(
    path: string,
    options: RequestOptions,
    mayRefresh: boolean,
  ): Promise<T> => {
    const url = new URL(`${deps.baseUrl}/api${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const isForm = options.body instanceof FormData;
    const headers: Record<string, string> = {};
    // The browser sets multipart/form-data itself, with the boundary.
    if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: options.method ?? 'GET',
        headers,
        // The refresh cookie belongs to the API's origin; only the auth routes read it.
        credentials: 'include',
        body:
          options.body === undefined
            ? undefined
            : isForm
              ? (options.body as FormData)
              : JSON.stringify(options.body),
      });
    } catch {
      throw ApiError.network();
    }

    // 204 and other empty answers have no body to parse.
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      if (response.status === 401 && options.token) {
        const token = mayRefresh && deps.refresh ? await deps.refresh(options.token) : null;
        if (token) return send<T>(path, { ...options, token }, false);
        deps.onUnauthorized?.();
      }
      throw ApiError.fromBody(response.status, body);
    }
    return body as T;
  };
  return (path, options = {}) => send(path, options, true);
}
