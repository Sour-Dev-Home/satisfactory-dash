import type { PowerHistoryPoint, PowerHistoryResponse } from "../src/index";

// SYNTHETIC series (FRM has no history endpoint, so there is no capture of one), built from
// the base readings of the 2026-09-22 getPower captures (see fixtures/power.ts) with a small
// deterministic wobble, rounded to 0.1 MW. No randomness: a fixture must be identical on every run.
const SAMPLE_MS = 5000;
const WINDOW_SECONDS = 300;
const INTERVAL_SECONDS = 5;
/** The last sample of every fixture, matching the observedAt of the power fixtures. */
const END_MS = Date.parse("2026-09-22T22:42:39.000Z");
const meta = { serverId: "default", observedAt: "2026-09-22T22:42:39.000Z", stale: false };

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Timestamps for `count` samples ending at END_MS, oldest first. */
const times = (count: number): number[] => Array.from({ length: count }, (_, i) => END_MS - (count - 1 - i) * SAMPLE_MS);

/** Main grid (circuit group 0): 3633 MW produced, ~2916 MW drawn, 4083 MW capacity, no batteries. */
function mainGridPoints(count: number): PowerHistoryPoint[] {
  return times(count).map((t, i) => ({
    t,
    productionMW: round1(3633.3 + 40 * Math.sin(i / 5)),
    consumptionMW: round1(2915.6 + 60 * Math.sin(i / 4)),
    capacityMW: 4083.3,
    batteryPercent: 0,
    fuseTriggered: false,
  }));
}

/** Full window: 60 samples of one circuit, 5 s apart. */
export const powerHistoryNormal = {
  ...meta,
  data: {
    windowSeconds: WINDOW_SECONDS,
    intervalSeconds: INTERVAL_SECONDS,
    series: [{ circuitGroupId: 0, points: mainGridPoints(60) }],
    pausedRanges: [],
  },
} satisfies PowerHistoryResponse;

/** The game was paused for ten samples in the middle: the readings freeze at the last live
 *  value, and pausedRanges lets the chart shade that stretch (ADR-0012). */
const pausedPoints = mainGridPoints(40);
const frozen = pausedPoints[14];
for (let i = 15; i <= 24; i++) {
  pausedPoints[i] = { ...frozen, t: pausedPoints[i].t };
}
export const powerHistoryPaused = {
  ...meta,
  data: {
    windowSeconds: WINDOW_SECONDS,
    intervalSeconds: INTERVAL_SECONDS,
    series: [{ circuitGroupId: 0, points: pausedPoints }],
    pausedRanges: [{ fromT: pausedPoints[15].t, toT: pausedPoints[24].t }],
  },
} satisfies PowerHistoryResponse;

/** Right after the backend starts, or after a reset (a new session, or the game clock went
 *  backwards): nothing sampled yet. */
export const powerHistoryEmpty = {
  ...meta,
  data: { windowSeconds: WINDOW_SECONDS, intervalSeconds: INTERVAL_SECONDS, series: [], pausedRanges: [] },
} satisfies PowerHistoryResponse;

/** Circuit group 1 (a 60 MW side grid, as in the CJ capture) trips its fuse halfway through:
 *  its readings drop to 0 and fuseTriggered stays true. Group 0 is unaffected. */
const sideGrid: PowerHistoryPoint[] = times(60).map((t, i) =>
  i < 30
    ? {
        t,
        productionMW: round1(62.5 + 2 * Math.sin(i / 3)),
        consumptionMW: round1(58.4 + 3 * Math.sin(i / 2)),
        capacityMW: 65,
        batteryPercent: 0,
        fuseTriggered: false,
      }
    : { t, productionMW: 0, consumptionMW: 0, capacityMW: 0, batteryPercent: 0, fuseTriggered: true },
);
export const powerHistoryFuseTrip = {
  ...meta,
  data: {
    windowSeconds: WINDOW_SECONDS,
    intervalSeconds: INTERVAL_SECONDS,
    series: [
      { circuitGroupId: 0, points: mainGridPoints(60) },
      { circuitGroupId: 1, points: sideGrid },
    ],
    pausedRanges: [],
  },
} satisfies PowerHistoryResponse;
