/**
 * ADR-0027 decision 5: when to try a delivery again. Exponential backoff from 30 seconds, doubling, capped at 30
 * minutes, and never sooner than Discord asked (429 `retry_after`). A row is dead once it is older than 24 hours.
 * Pure: the caller passes the clock.
 */

export const BASE_DELAY_MS = 30_000;
export const MAX_DELAY_MS = 30 * 60_000;
/** A delivery that has not succeeded after this long is given up on. */
export const DEAD_AFTER_MS = 24 * 60 * 60_000;

/** The delay before attempt number `attempt + 1`, where `attempt` counts the attempts already made (at least 1). */
export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  const made = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(made - 1, 20));
  const asked = retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0;
  return Math.max(exponential, asked);
}

/** true = give up: it has been trying for 24 hours or more. */
export function isDead(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs >= DEAD_AFTER_MS;
}
