/**
 * Retry delays with jitter (ADR-0031 PR 6). Exponential from `baseMs`, capped at `maxMs`, then "equal jitter": half of it
 * fixed and half random, so a fleet of agents that lost the backend together does not come back together, and no delay
 * collapses to about zero. `attempt` counts from 0 (the first retry).
 */
export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Injectable for tests: returns a number in [0, 1). */
  random?: () => number;
}

export const DEFAULT_BACKOFF_BASE_MS = 1_000;
export const DEFAULT_BACKOFF_MAX_MS = 60_000;

export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const max = options.maxMs ?? DEFAULT_BACKOFF_MAX_MS;
  const random = options.random ?? Math.random;
  const exponent = Number.isFinite(attempt) ? Math.min(Math.max(0, Math.floor(attempt)), 30) : 0; // 2 ** 30 is far past any cap: no float overflow games
  const ceiling = Math.min(max, base * 2 ** exponent);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
