export interface RateLimiterOptions {
  /** Max requests started in any 60 s window. Zoho allows 100 per org. */
  requestsPerMinute?: number;
  /** Max requests in flight. Zoho allows 10 on paid plans. */
  maxConcurrent?: number;
  /** Window size in ms, for tests. */
  windowMs?: number;
}

/** Keeps one organization under Zoho's rate and concurrency limits in this process. */
export class RateLimiter {
  private readonly rpm: number;
  private readonly maxConcurrent: number;
  private readonly windowMs: number;
  private readonly starts: number[] = [];
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** No request starts before this epoch ms. */
  private pausedUntil = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.rpm = Math.max(1, options.requestsPerMinute ?? 100);
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 10);
    this.windowMs = options.windowMs ?? 60_000;
  }

  /** Run fn when a slot is free. Rejects with the abort reason if signal fires while queued. */
  async schedule<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.active--;
      this.drain();
    }
  }

  /** Hold every new request for ms, used after a 429. */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(signal!.reason);
      };
      const waiter = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    if (this.timer) return;
    while (this.waiters.length > 0) {
      const now = Date.now();
      while (this.starts.length > 0 && now - this.starts[0]! >= this.windowMs) this.starts.shift();

      if (this.active >= this.maxConcurrent) return;

      let waitMs = 0;
      if (this.pausedUntil > now) waitMs = this.pausedUntil - now;
      else if (this.starts.length >= this.rpm) waitMs = this.windowMs - (now - this.starts[0]!);

      if (waitMs > 0) {
        // Not unref'd so a queued caller keeps the process alive.
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.drain();
        }, waitMs);
        return;
      }

      this.starts.push(now);
      this.active++;
      this.waiters.shift()!();
    }
  }
}
