import type { HistoryItems, HistoryTransitions } from "@satisfactory-dash/shared";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Whole minutes are rolled up a minute late (the history contract): give a closed hour that long to settle. */
const ROLLUP_LAG = 2 * 60_000;

/**
 * What counts as a notable change since yesterday (ADR-0027 item 6). A product default, not a law:
 * the owner can change it. Both must hold: a change of at least 10% of yesterday's rate, and of at
 * least 1 per minute, so a trickle going from 0.2 to 0.1 isn't news.
 */
export const NOTABLE_CHANGE = { minRatio: 0.1, minPerMinute: 1 } as const;
/** How many notable changes each list shows, biggest first. */
export const MAX_CHANGES = 3;

export interface ItemChange {
  /** Item class name, from the history series. */
  item: string;
  /** Average per minute in the same hour yesterday. */
  before: number;
  /** Average per minute in the latest complete hour. */
  after: number;
  /** after − before. */
  delta: number;
  /** delta / before; null when there was nothing yesterday (a new item). */
  ratio: number | null;
}

export type SinceYesterday =
  | { enough: false }
  | {
      enough: true;
      /** Start of the latest complete hour, Unix ms UTC; yesterday's hour is 24 h before it. */
      hour: number;
      /** Notable drops, the biggest relative drop first. */
      down: ItemChange[];
      /** Notable rises, the biggest relative rise first (new items after them, largest first). */
      up: ItemChange[];
    };

/** The start of the latest hour that is closed (and rolled up) at `to`. */
export function latestCompleteHour(to: number): number {
  return Math.floor((to - ROLLUP_LAG) / HOUR) * HOUR - HOUR;
}

function isNotable(before: number, after: number): boolean {
  const delta = Math.abs(after - before);
  if (delta < NOTABLE_CHANGE.minPerMinute) return false;
  return before === 0 || delta / before >= NOTABLE_CHANGE.minRatio;
}

/** Relative size, with new items (no ratio) after every item that has one. */
const byMagnitude = (a: ItemChange, b: ItemChange) =>
  a.ratio === null || b.ratio === null
    ? (a.ratio === null ? 1 : 0) - (b.ratio === null ? 1 : 0) || Math.abs(b.delta) - Math.abs(a.delta)
    : Math.abs(b.ratio) - Math.abs(a.ratio) || Math.abs(b.delta) - Math.abs(a.delta);

/**
 * The latest complete hour of each item vs the same hour yesterday, from the 7d range's hourly
 * buckets. Only complete hours are compared: the newest bucket can still be open. An item missing
 * either hour (a gap: paused or unreachable) is left out, never interpolated.
 */
export function sinceYesterday(history: HistoryItems): SinceYesterday {
  if (history.resolutionSeconds !== 3600) return { enough: false };
  const hour = latestCompleteHour(history.to);
  const changes: ItemChange[] = [];
  let compared = 0;
  for (const { item, points } of history.series) {
    const now = points.find((p) => p.t === hour);
    const then = points.find((p) => p.t === hour - DAY);
    if (!now || !then) continue;
    compared++;
    const before = then.currentPerMinute.avg;
    const after = now.currentPerMinute.avg;
    if (!isNotable(before, after)) continue;
    const delta = after - before;
    changes.push({ item, before, after, delta, ratio: before === 0 ? null : delta / before });
  }
  if (compared === 0) return { enough: false };
  return {
    enough: true,
    hour,
    down: changes.filter((c) => c.delta < 0).sort(byMagnitude).slice(0, MAX_CHANGES),
    up: changes.filter((c) => c.delta > 0).sort(byMagnitude).slice(0, MAX_CHANGES),
  };
}

/** "37", or "500+" when the backend had more than it sent. */
export function transitionCount(transitions: HistoryTransitions): string {
  const n = transitions.transitions.length;
  return transitions.truncated ? `${n}+` : String(n);
}
