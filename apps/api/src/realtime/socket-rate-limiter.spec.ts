import { SocketRateLimiter } from './socket-rate-limiter';

describe('SocketRateLimiter', () => {
  let now = 0;
  const limiter = new SocketRateLimiter(() => now);

  beforeEach(() => {
    now = 10_000;
    limiter.forget('a');
    limiter.forget('b');
  });

  it('allows the limit within a second and refuses the next one', () => {
    for (let i = 0; i < 3; i++) {
      expect(limiter.take('a', 'send', 3)).toBe(true);
    }
    expect(limiter.take('a', 'send', 3)).toBe(false);
  });

  it('starts over in the next second', () => {
    for (let i = 0; i < 4; i++) limiter.take('a', 'send', 3);
    now += 1000;
    expect(limiter.take('a', 'send', 3)).toBe(true);
  });

  it('counts each socket and each event apart', () => {
    for (let i = 0; i < 3; i++) limiter.take('a', 'send', 3);
    expect(limiter.take('b', 'send', 3)).toBe(true);
    expect(limiter.take('a', 'read', 3)).toBe(true);
  });
});
