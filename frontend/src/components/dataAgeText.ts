import { formatDuration } from "../format";

/**
 * How old the numbers on screen are (ADR-0032 step 3): "Updated 8 s ago" from a snapshot's
 * `observedAt`, and `late` once that's past twice the view's poll interval, when a fresh reading
 * should have arrived twice over. A reading "from the future" (the clocks disagree) counts as now.
 */
export function dataAge(observedAt: string, now: number, pollMs: number): { text: string; late: boolean } {
  const observed = Date.parse(observedAt);
  if (Number.isNaN(observed)) return { text: "Updated at an unknown time", late: true };
  const ageMs = Math.max(0, now - observed);
  const seconds = Math.floor(ageMs / 1000);
  return {
    text: seconds < 1 ? "Updated just now" : `Updated ${formatDuration(seconds)} ago`,
    late: ageMs > 2 * pollMs,
  };
}
