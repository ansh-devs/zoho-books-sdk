/**
 * Client-side throttling so we stay under Zoho's limits instead of bouncing
 * off 429s: a sliding-window requests-per-minute limit plus a concurrency cap.
 */
export interface RateLimiterOptions {
  /** Max requests started in any rolling 60 s window. Zoho default is 100/org. */
  requestsPerMinute?: number;
  /** Max in-flight requests. Zoho caps concurrency per org by plan. */
  maxConcurrent?: number;
  /** Window size, overridable for tests. */
  windowMs?: number;
}

export class RateLimiter {
  private readonly rpm: number;
  private readonly maxConcurrent: number;
  private readonly windowMs: number;
  private readonly starts: number[] = [];
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Epoch ms before which no request may start (set after a 429). */
  private pausedUntil = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.rpm = Math.max(1, options.requestsPerMinute ?? 100);
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 10);
    this.windowMs = options.windowMs ?? 60_000;
  }

  /** Run `fn` once a slot is free. */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Block every new request for `ms` (used when the server says 429). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.drain();
    });
  }

  private release(): void {
    this.active--;
    this.drain();
  }

  private drain(): void {
    if (this.timer) return;
    while (this.waiters.length > 0) {
      const now = Date.now();
      while (this.starts.length > 0 && now - this.starts[0]! >= this.windowMs) this.starts.shift();

      if (this.active >= this.maxConcurrent) return; // release() will call drain()

      let waitMs = 0;
      if (this.pausedUntil > now) waitMs = this.pausedUntil - now;
      else if (this.starts.length >= this.rpm) waitMs = this.windowMs - (now - this.starts[0]!);

      if (waitMs > 0) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.drain();
        }, waitMs);
        // Not unref'd on purpose: a caller awaiting a queued request must keep
        // the process alive until it runs.
        return;
      }

      this.starts.push(now);
      this.active++;
      this.waiters.shift()!();
    }
  }
}
