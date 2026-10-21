import { ipKeyGenerator } from "express-rate-limit";

/** New accounts one network may create in a day (ADR-0046 C8 follow-up): an IPv4 address or an IPv6 /56. */
export const SIGNUPS_PER_NETWORK_PER_DAY = 3;
export const SIGNUP_NETWORK_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Bounds memory if many distinct networks sign up once each. */
const MAX_TRACKED_NETWORKS = 10_000;

const keyFor = (ip: string): string => {
  try {
    return ipKeyGenerator(ip, 56);
  } catch {
    return ip;
  }
};

export interface SignupNetworkLimit {
  /** Whether this network may create another account now (does not count). */
  allows(ip: string): boolean;
  /** Counts one account created from this network. */
  record(ip: string): void;
}

/**
 * In memory only, like every limiter here (the privacy page says rate limiting is memory-only; one
 * backend instance). Stops one network from using up the process-wide hourly cap (C8) alone. The caller
 * holds the sign-up lock, so allows() then record() cannot be raced past the limit. A restart forgets it.
 */
export function createSignupNetworkLimit(
  now: () => number = Date.now,
  limit: number = SIGNUPS_PER_NETWORK_PER_DAY,
): SignupNetworkLimit {
  const buckets = new Map<string, number[]>();
  const live = (key: string): number[] => {
    const cutoff = now() - SIGNUP_NETWORK_WINDOW_MS;
    const times = (buckets.get(key) ?? []).filter((at) => at > cutoff);
    if (times.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, times);
    }
    return times;
  };
  return {
    allows: (ip) => live(keyFor(ip)).length < limit,
    record(ip) {
      const key = keyFor(ip);
      const times = live(key);
      if (times.length === 0 && buckets.size >= MAX_TRACKED_NETWORKS) {
        // Full of live entries: drop the oldest rather than grow without bound.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      times.push(now());
      buckets.set(key, times);
    },
  };
}
