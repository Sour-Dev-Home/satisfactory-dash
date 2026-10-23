import { ipKeyGenerator } from "express-rate-limit";

/** Addresses in one IPv6 /56 share a bucket (a client usually controls a whole block,
 *  so per-address keys would give it fresh attempts; found by PR #24's fresh-eyes
 *  review). The same grouping express-rate-limit uses for the outer request cap. */
function keyFor(ip: string): string {
  try {
    return ipKeyGenerator(ip, 56);
  } catch {
    return ip;
  }
}

/**
 * ADR-0011: in-process rate limit on login attempts, per client IP. After
 * MAX_FAILURES failed attempts inside the window, every attempt from that IP is
 * refused (429 rate_limited) until the window ends -- even with the right password,
 * so guessing can't continue. A successful login clears the IP's count.
 *
 * #562: a second, process-wide budget of GLOBAL_MAX_FAILURES failures per window bounds a
 * guess spread over many addresses (there is one password account, the operator's). When it
 * is spent, password logins from every network are refused until the window ends, except
 * from a network that completed a password login in the last TRUSTED_MS, so a flood never
 * locks the operator out of the networks they use. Such a network still has its per-IP limit.
 * A successful login is refunded, so it never spends the global budget.
 *
 * In-process on purpose: one backend instance (ADR-0010). With more than one instance
 * this moves to a shared store (Redis), per ADR-0010's trigger (c).
 */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
/** Failures from all untrusted networks together per window: about 9,600 guesses a day at most. */
export const GLOBAL_MAX_FAILURES = 100;
/** How long a network that signed in keeps skipping the global budget. */
export const TRUSTED_MS = 7 * 24 * 60 * 60 * 1000;
/** Bounds memory if many distinct IPs fail once each. */
export const MAX_TRACKED_IPS = 10_000;
/** Only the operator signs in with a password, from a handful of networks. */
const MAX_TRUSTED_NETWORKS = 100;

interface Bucket {
  failures: number;
  resetAt: number;
}

export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  /** Network key -> when its trust ends. */
  private readonly trusted = new Map<string, number>();
  private globalFailures = 0;
  private globalResetAt = 0;
  /** Network key -> the global window it was charged in, so a success refunds only that window (review, #562). */
  private readonly charged = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxTrackedIps: number = MAX_TRACKED_IPS,
  ) {}

  /** Seconds until this IP may try again, or 0 if it may try now. */
  retryAfterSeconds(ip: string): number {
    const key = keyFor(ip);
    const bucket = this.current(key);
    if (bucket && bucket.failures >= MAX_FAILURES) {
      return this.secondsUntil(bucket.resetAt);
    }
    if (!this.isTrusted(key) && this.globalWindow() >= GLOBAL_MAX_FAILURES) {
      return this.secondsUntil(this.globalResetAt);
    }
    // A new key while the table is full of blocked buckets: refuse it rather than forget a
    // block to make room. The oldest bucket ends first (Map order is insertion order).
    if (!bucket && this.buckets.size >= this.maxTrackedIps) {
      this.prune();
      const oldest = this.buckets.values().next().value;
      if (this.buckets.size >= this.maxTrackedIps && oldest) {
        return this.secondsUntil(oldest.resetAt);
      }
    }
    return 0;
  }

  /**
   * Counted BEFORE the password check (see the route); recordSuccess undoes it. Returns true when this failure spent
   * the last of the global budget, so the route can log it once per window: from then until the window ends, password
   * sign-in is refused from every network that hasn't signed in recently (an attack, or a forgotten password).
   */
  recordFailure(ip: string): boolean {
    const key = keyFor(ip);
    let spent = false;
    if (!this.isTrusted(key)) {
      this.globalWindow();
      this.globalFailures += 1;
      this.charged.set(key, this.globalResetAt);
      spent = this.globalFailures === GLOBAL_MAX_FAILURES;
    }
    const bucket = this.current(key);
    if (bucket) {
      bucket.failures += 1;
      return spent;
    }
    if (this.buckets.size >= this.maxTrackedIps) {
      this.prune();
      // Every bucket is a live block: retryAfterSeconds refuses this key, so there is nothing to track.
      if (this.buckets.size >= this.maxTrackedIps) {
        return spent;
      }
    }
    this.buckets.set(key, { failures: 1, resetAt: this.now() + WINDOW_MS });
    return spent;
  }

  /**
   * A completed password sign-in. Only the operator signs in with a password (SingleOperatorAuthenticator; Google
   * sign-in never calls this), so only the operator's networks become trusted. If password sign-in ever opens to other
   * accounts, trust must stay operator-only, or anyone could fill the trusted set (security review, #562).
   */
  recordSuccess(ip: string): void {
    const key = keyFor(ip);
    this.buckets.delete(key);
    // Refund the pre-counted attempt only in the window it was charged in, so a success after a rollover never lowers
    // the new window's count (security review, #562).
    if (this.charged.get(key) === this.globalResetAt && this.globalFailures > 0) this.globalFailures -= 1;
    this.charged.delete(key);
    if (this.isTrusted(key)) this.trusted.delete(key);
    if (this.trusted.size >= MAX_TRUSTED_NETWORKS) {
      const oldest = this.trusted.keys().next().value;
      if (oldest !== undefined) {
        this.trusted.delete(oldest);
      }
    }
    this.trusted.set(key, this.now() + TRUSTED_MS);
  }

  private secondsUntil(at: number): number {
    return Math.max(1, Math.ceil((at - this.now()) / 1000));
  }

  /** The global count for the current fixed window, starting a new window if the last one ended. */
  private globalWindow(): number {
    if (this.globalResetAt <= this.now()) {
      this.globalFailures = 0;
      this.globalResetAt = this.now() + WINDOW_MS;
      // Charges from an ended window are never refunded, so this map holds at most one window's failures.
      this.charged.clear();
    }
    return this.globalFailures;
  }

  private isTrusted(key: string): boolean {
    const until = this.trusted.get(key);
    if (until === undefined) {
      return false;
    }
    if (until <= this.now()) {
      this.trusted.delete(key);
      return false;
    }
    return true;
  }

  private current(ip: string): Bucket | undefined {
    const bucket = this.buckets.get(ip);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(ip);
      return undefined;
    }
    return bucket;
  }

  /** Drops ended buckets, then the oldest buckets that aren't blocking, until there is room.
   *  Never drops a live block (#562): that would hand its owner fresh attempts. */
  private prune(): void {
    const now = this.now();
    for (const [ip, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(ip);
      }
    }
    for (const [ip, bucket] of this.buckets) {
      if (this.buckets.size < this.maxTrackedIps) {
        break;
      }
      if (bucket.failures < MAX_FAILURES) {
        this.buckets.delete(ip);
      }
    }
  }
}
