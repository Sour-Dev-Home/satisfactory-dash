/**
 * ADR-0011: in-process rate limit on login attempts, per client IP. After
 * MAX_FAILURES failed attempts inside the window, every attempt from that IP is
 * refused (429 rate_limited) until the window ends -- even with the right password,
 * so guessing can't continue. A successful login clears the IP's count.
 *
 * In-process on purpose: one backend instance (ADR-0010). With more than one instance
 * this moves to a shared store (Redis), per ADR-0010's trigger (c).
 */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
/** Bounds memory if many distinct IPs fail once each. */
const MAX_TRACKED_IPS = 10_000;

interface Bucket {
  failures: number;
  resetAt: number;
}

export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds until this IP may try again, or 0 if it may try now. */
  retryAfterSeconds(ip: string): number {
    const bucket = this.current(ip);
    if (!bucket || bucket.failures < MAX_FAILURES) {
      return 0;
    }
    return Math.max(1, Math.ceil((bucket.resetAt - this.now()) / 1000));
  }

  recordFailure(ip: string): void {
    const bucket = this.current(ip);
    if (bucket) {
      bucket.failures += 1;
      return;
    }
    if (this.buckets.size >= MAX_TRACKED_IPS) {
      this.prune();
    }
    this.buckets.set(ip, { failures: 1, resetAt: this.now() + WINDOW_MS });
  }

  recordSuccess(ip: string): void {
    this.buckets.delete(ip);
  }

  private current(ip: string): Bucket | undefined {
    const bucket = this.buckets.get(ip);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(ip);
      return undefined;
    }
    return bucket;
  }

  private prune(): void {
    const now = this.now();
    for (const [ip, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(ip);
      }
    }
    // Still full of live entries: drop the oldest rather than grow without bound.
    while (this.buckets.size >= MAX_TRACKED_IPS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.buckets.delete(oldest);
    }
  }
}
