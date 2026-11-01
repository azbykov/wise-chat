/** Fixed one-second windows per socket and event; memory is freed when the socket goes away. */
export class SocketRateLimiter {
  private readonly windows = new Map<string, Map<string, { start: number; count: number }>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** True if the event may proceed, false once the socket used up this second's allowance. */
  take(socketId: string, event: string, perSecond: number): boolean {
    const now = this.now();
    let events = this.windows.get(socketId);
    if (!events) {
      events = new Map();
      this.windows.set(socketId, events);
    }
    const window = events.get(event);
    if (!window || now - window.start >= 1000) {
      events.set(event, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= perSecond;
  }

  forget(socketId: string): void {
    this.windows.delete(socketId);
  }
}
