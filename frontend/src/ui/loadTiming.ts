/**
 * The loading timings (#494), read from their tokens in `@theme` (src/index.css) so CSS stays the one
 * place the values live. The fallbacks are for where no stylesheet is loaded (unit tests, jsdom);
 * `loadTiming.test.ts` fails if they drift from the tokens.
 */
export const LOAD_TOKENS = {
  /** A skeleton appears only if its data takes longer than this. */
  skeletonDelay: { name: "--duration-skeleton-delay", fallbackMs: 150 },
  /** Once shown, a skeleton stays at least this long (0 under reduced motion). */
  skeletonMin: { name: "--duration-skeleton-min", fallbackMs: 300 },
  /** A page waits this long for its primary queries before it reveals what it has. */
  revealBudget: { name: "--duration-reveal-budget", fallbackMs: 400 },
} as const;

type LoadToken = (typeof LOAD_TOKENS)[keyof typeof LOAD_TOKENS];

/** A CSS time ("150ms", "0.3s", "0s") in milliseconds, or undefined if it isn't one. */
export function parseCssTime(value: string): number | undefined {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

/** A token's current value in ms: the stylesheet's (reduced motion included), else the fallback. */
export function loadMs(token: LoadToken): number {
  if (typeof document === "undefined") return token.fallbackMs;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token.name);
  return parseCssTime(raw) ?? token.fallbackMs;
}
