import { parseRange, UNSATISFIABLE } from './range';

describe('parseRange', () => {
  it('sends everything without a usable header', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('items=0-5', 100)).toBeNull();
    expect(parseRange('bytes=0-5,10-15', 100)).toBeNull();
    expect(parseRange('bytes=10-5', 100)).toBeNull();
  });

  it('reads from-to, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
  });

  it('trims the range to the file', () => {
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('refuses ranges that start past the end', () => {
    expect(parseRange('bytes=100-', 100)).toBe(UNSATISFIABLE);
    expect(parseRange('bytes=-0', 100)).toBe(UNSATISFIABLE);
    expect(parseRange('bytes=0-', 0)).toBe(UNSATISFIABLE);
  });
});
