import { describe, expect, it } from 'vitest';
import { safeNext } from './redirect';

describe('safeNext', () => {
  it('keeps a path inside the app, with its query and hash', () => {
    expect(safeNext('/chats/42?x=1#end')).toBe('/chats/42?x=1#end');
  });

  it('falls back to the chats when there is nothing to return to', () => {
    expect(safeNext(null)).toBe('/chats');
    expect(safeNext('')).toBe('/chats');
  });

  it.each(['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'chats'])(
    'refuses %s',
    (next) => {
      expect(safeNext(next)).toBe('/chats');
    },
  );
});
