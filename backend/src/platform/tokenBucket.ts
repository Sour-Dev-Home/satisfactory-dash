/**
 * A token bucket per key, in process (one backend instance, ADR-0010). Each key starts full at `capacity` and refills at
 * `refillPerSecond`, up to `capacity`. Unlike `UserRateLimiter`'s fixed window, a bucket lets a client spend a saved-up
 * burst (an agent draining its queue after an outage) and then holds it to the steady rate, with no doubled burst at a
 * window edge.
 *
 * Two ways to spend:
 * - `take(key, cost)`: the cost is known up front (one request). It is allowed, and deducted, only if the balance
 *   covers it.
 * - `admit(key)` then `charge(key, cost)`: the cost is known only later (a body's size once read). A key with a
 *   positive balance is admitted, and the actual cost is charged afterwards, which may put the balance into debt (never
 *   below `-capacity`). A key in debt is refused by `admit` until the debt is repaid, so the expensive work (reading and
 *   parsing a body) is never started for it, and a single item larger than the balance still gets through once the
 *   key has saved up, rather than never.
 *
 * Every refusal returns the whole seconds (at least 1) until the call would succeed, for `Retry-After`; 0 means allowed.
 * The number of tracked keys is bounded: a full bucket is the same as no entry, so full ones are dropped first, and only
 * if every tracked key is still refilling is the oldest one dropped (which only forgives that key).
 */
export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  /** Default 1,000. */
  maxKeys?: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  at: number;
}

const DEFAULT_MAX_KEYS = 1_000;

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(private readonly options: TokenBucketOptions) {
    if (!(options.capacity > 0) || !(options.refillPerSecond > 0)) throw new RangeError("a bucket needs a positive capacity and refill rate");
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /** Spends `cost` if the balance covers it; otherwise spends nothing and returns the seconds to wait. */
  take(key: string, cost = 1): number {
    const bucket = this.current(key);
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.store(key, bucket);
      return 0;
    }
    return this.secondsUntil(cost - bucket.tokens);
  }

  /** 0 when the key's balance is positive (it may spend); otherwise the seconds until it is. Spends nothing. */
  admit(key: string): number {
    const bucket = this.current(key);
    return bucket.tokens > 0 ? 0 : this.secondsUntil(-bucket.tokens + Number.EPSILON);
  }

  /** Deducts `cost` unconditionally (after an `admit`), down to at most `-capacity`. */
  charge(key: string, cost: number): void {
    const bucket = this.current(key);
    bucket.tokens = Math.max(-this.options.capacity, bucket.tokens - cost);
    this.store(key, bucket);
  }

  /** Tests and diagnostics: the number of keys tracked. */
  get size(): number {
    return this.buckets.size;
  }

  private current(key: string): Bucket {
    const bucket = this.buckets.get(key);
    // Never earlier than what is stored: a clock stepped back must not make the next step forward refill for time that
    // had already been counted.
    const at = bucket === undefined ? this.now() : Math.max(this.now(), bucket.at);
    if (bucket === undefined) return { tokens: this.options.capacity, at };
    const elapsedSeconds = Math.max(0, at - bucket.at) / 1000;
    return { tokens: Math.min(this.options.capacity, bucket.tokens + elapsedSeconds * this.options.refillPerSecond), at };
  }

  private store(key: string, bucket: Bucket): void {
    if (!this.buckets.has(key) && this.buckets.size >= this.maxKeys) {
      for (const [k, existing] of this.buckets) {
        const refilled = existing.tokens + (Math.max(0, bucket.at - existing.at) / 1000) * this.options.refillPerSecond;
        if (refilled >= this.options.capacity) this.buckets.delete(k);
      }
      if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value as string);
    }
    this.buckets.delete(key); // re-insert, so Map order is least recently spent first
    this.buckets.set(key, bucket);
  }

  private secondsUntil(missing: number): number {
    return Math.max(1, Math.ceil(missing / this.options.refillPerSecond));
  }
}
