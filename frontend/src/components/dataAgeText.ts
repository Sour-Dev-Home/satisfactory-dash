import { formatDuration } from "../format";

/**
 * How old the numbers on screen are (ADR-0032 step 3): "Updated 8 s ago" from a snapshot's
 * `observedAt`. Text only: this clock can disagree with the backend's, so whether the data is late
 * is the backend's call (`stale`), never this age. A reading "from the future" counts as now.
 */
export function dataAgeText(observedAt: string, now: number): string {
  const observed = Date.parse(observedAt);
  if (Number.isNaN(observed)) return "Updated at an unknown time";
  const seconds = Math.floor(Math.max(0, now - observed) / 1000);
  return seconds < 1 ? "Updated just now" : `Updated ${formatDuration(seconds)} ago`;
}
