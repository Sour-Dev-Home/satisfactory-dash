/**
 * A fixed-window limit per key (a signed-in user's id), in process (one backend instance, ADR-0010).
 * `hit` counts one request and returns 0 when it may proceed, or the seconds until the window ends
 * when the key is over `max`. The number of tracked keys is bounded, and expired windows are dropped
 * as new keys arrive, so a flood of distinct keys cannot grow it without limit.
 */
export interface UserRateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

const MAX_TRACKED_KEYS = 1_000;

export class UserRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly now: () => number;

  constructor(private readonly options: UserRateLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  hit(key: string): number {
    const now = this.now();
    const current = this.windows.get(key);
    if (current !== undefined && current.resetAt > now) {
      current.count += 1;
      return current.count > this.options.max ? Math.max(1, Math.ceil((current.resetAt - now) / 1000)) : 0;
    }
    if (this.windows.size >= MAX_TRACKED_KEYS) {
      for (const [k, window] of this.windows) {
        if (window.resetAt <= now) this.windows.delete(k);
      }
      if (this.windows.size >= MAX_TRACKED_KEYS) this.windows.clear();
    }
    this.windows.set(key, { count: 1, resetAt: now + this.options.windowMs });
    return 0;
  }
}
