import type { HistoryItemsResponse, HistoryPowerResponse, HistoryTransitionsResponse } from "../src/index";

// SYNTHETIC (invented ids and numbers), a few points each so they stay readable. Times are Unix ms UTC, aligned
// to the bucket (2026-09-25T12:00:00Z = 1790337600000).
const T0 = 1_790_337_600_000;
const FIVE_MINUTES = 300_000;
const HOUR = 3_600_000;

/** 24h range: 5-minute buckets, read from the 1-MINUTE rollups. Two game sessions: series are never merged
 *  across them, and the series with the newest data comes first. A gap (T0 + 2 buckets) is a gap, not zero. */
export const historyPower24h = {
  serverId: "default",
  observedAt: "2026-09-25T12:14:00.000Z",
  stale: false,
  data: {
    range: "24h",
    resolutionSeconds: 300,
    from: T0 - 86_400_000 + 14 * 60_000,
    to: T0 + 14 * 60_000,
    series: [
      {
        session: 1_918_273_645,
        circuit: 1,
        points: [
          {
            t: T0,
            samples: 60,
            productionMW: { min: 118, avg: 120.5, max: 123 },
            consumptionMW: { min: 84, avg: 90.25, max: 97 },
            capacityMW: 150,
            batteryPercent: { min: 0, avg: 0, max: 0 },
            fuseTrippedSamples: 0,
          },
          {
            t: T0 + FIVE_MINUTES,
            samples: 60,
            productionMW: { min: 119, avg: 121, max: 124 },
            consumptionMW: { min: 88, avg: 93, max: 99 },
            capacityMW: 150,
            batteryPercent: { min: 0, avg: 0, max: 0 },
            fuseTrippedSamples: 0,
          },
          // T0 + 2 * FIVE_MINUTES is missing: nothing was recorded (paused or unreachable).
          {
            t: T0 + 3 * FIVE_MINUTES,
            samples: 12,
            productionMW: { min: 0, avg: 0, max: 0 },
            consumptionMW: { min: 0, avg: 0, max: 0 },
            capacityMW: 0,
            batteryPercent: { min: 0, avg: 0, max: 0 },
            fuseTrippedSamples: 12,
          },
        ],
      },
      {
        // An older game session: same circuit id, a different circuit.
        session: -1_204_866_331,
        circuit: 1,
        points: [
          {
            t: T0 - 6 * HOUR,
            samples: 60,
            productionMW: { min: 60, avg: 61, max: 62 },
            consumptionMW: { min: 40, avg: 41.5, max: 43 },
            capacityMW: 75,
            batteryPercent: { min: 20, avg: 55.5, max: 90 },
            fuseTrippedSamples: 0,
          },
        ],
      },
    ],
  },
} satisfies HistoryPowerResponse;

/** 7d range: 1-hour buckets, read from the HOURLY rollups (the newest hour can lag by up to an hour). */
export const historyItems7d = {
  serverId: "default",
  observedAt: "2026-09-25T12:14:00.000Z",
  stale: false,
  data: {
    range: "7d",
    resolutionSeconds: 3600,
    from: T0 - 7 * 86_400_000 + 14 * 60_000,
    to: T0 + 14 * 60_000,
    truncated: false,
    series: [
      {
        item: "Desc_IronPlate_C",
        points: [
          { t: T0 - 2 * HOUR, samples: 120, currentPerMinute: { min: 380, avg: 400, max: 420 }, maxPerMinute: 480 },
          { t: T0 - HOUR, samples: 120, currentPerMinute: { min: 390, avg: 410.5, max: 430 }, maxPerMinute: 480 },
        ],
      },
      {
        item: "Desc_Wire_C",
        points: [{ t: T0 - HOUR, samples: 120, currentPerMinute: { min: 90, avg: 100, max: 110 }, maxPerMinute: 120 }],
      },
    ],
  },
} satisfies HistoryItemsResponse;

/** Newest first; `truncated` says more exist than the limit. */
export const historyTransitions24h = {
  serverId: "default",
  observedAt: "2026-09-25T12:14:00.000Z",
  stale: false,
  data: {
    range: "24h",
    from: T0 - 86_400_000 + 14 * 60_000,
    to: T0 + 14 * 60_000,
    truncated: true,
    transitions: [
      { t: T0 + 10 * 60_000, buildingId: "Build_ConstructorMk1_C_2149000004", className: "Build_ConstructorMk1_C", fromState: "producing", toState: "underfed" },
      { t: T0 + 5 * 60_000, buildingId: "Build_AssemblerMk1_C_2149000003", className: "Build_AssemblerMk1_C", fromState: null, toState: "idle" },
    ],
  },
} satisfies HistoryTransitionsResponse;
