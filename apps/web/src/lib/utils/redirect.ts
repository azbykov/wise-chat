const FALLBACK = '/chats';

/**
 * Where to go after signing in. Only a path inside this app is accepted, so a crafted
 * `?next=` link cannot send the user to another site: `//evil.com` and `/\evil.com` are
 * resolved the way the browser would resolve them and rejected when they leave the origin.
 */
export function safeNext(next: string | null | undefined, origin = 'http://app.local'): string {
  if (!next || !next.startsWith('/')) {
    return FALLBACK;
  }
  const url = new URL(next, origin);
  if (url.origin !== origin) {
    return FALLBACK;
  }
  return url.pathname + url.search + url.hash;
}
