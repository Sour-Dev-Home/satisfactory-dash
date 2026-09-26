import { z } from "zod";
import { snapshotEnvelope } from "./envelope";

/**
 * ADR-0027 decision 3: stored production history, served from the `telemetry` schema (not the game server).
 * The in-memory 5-minute chart (powerHistory.ts, ADR-0022) is separate and unchanged.
 *
 * THE RANGE PICKS THE RESOLUTION. The backend aims for at most 600 points per series and re-buckets at query time
 * to the smallest of 1 minute, 5 minutes, 15 minutes, 1 hour, 6 hours and 1 day that fits:
 *
 *   range | bucket   | source rollups
 *   1h    | 1 minute | 1-minute
 *   6h    | 1 minute | 1-minute
 *   24h   | 5 minutes| 1-minute
 *   7d    | 1 hour   | hourly
 *   30d   | 6 hours  | hourly
 *   1y    | 1 day    | hourly
 *
 * A bucket under 1 hour is read from the 1-minute rollups, anything of 1 hour or more from the hourly rollups.
 * Buckets are aligned to UTC (a 1-day bucket is a UTC day). The newest bucket can lag: whole minutes are rolled up
 * a minute late, and the hourly rollups are recomputed while the hour is open, so on a 7d/30d/1y range the last
 * point can be up to an hour behind. Averages are weighted by the samples behind them. Nothing is interpolated: a
 * gap in the points means nothing was recorded (the game was paused or the server unreachable).
 */
export const HistoryRangeSchema = z.enum(["1h", "6h", "24h", "7d", "30d", "1y"]);
/** Transitions are kept 30 days, so a 1-year range does not exist for them. */
export const TransitionRangeSchema = z.enum(["1h", "6h", "24h", "7d", "30d"]);

const BucketStatSchema = z.object({
  min: z.number().describe("Lowest value of any sample in the bucket"),
  avg: z.number().describe("Average over the bucket, weighted by the samples behind it"),
  max: z.number().describe("Highest value of any sample in the bucket"),
});

const RangeInfo = {
  range: HistoryRangeSchema.describe("The range that was asked for"),
  resolutionSeconds: z.number().int().positive().describe("Bucket length, seconds (60 to 86400), chosen from the range"),
  from: z.number().int().min(0).describe("Start of the range, Unix ms UTC"),
  to: z.number().int().min(0).describe("End of the range (the time of the request), Unix ms UTC"),
};

export const HistoryPowerPointSchema = z.object({
  t: z.number().int().min(0).describe("Start of the bucket, Unix ms UTC, aligned to UTC"),
  samples: z.number().int().positive().describe("How many 5-second samples the bucket holds"),
  productionMW: BucketStatSchema,
  consumptionMW: BucketStatSchema,
  capacityMW: z.number().describe("Average generation capacity over the bucket, MW"),
  batteryPercent: BucketStatSchema,
  fuseTrippedSamples: z.number().int().min(0).describe("How many samples in the bucket had the fuse tripped"),
});

export const HistoryPowerSeriesSchema = z.object({
  session: z
    .number()
    .int()
    .describe(
      "32-bit hash of the game session's name. Circuit ids are not the same circuit across game sessions " +
        "(ADR-0006), so a series never merges across them; the frontend decides whether to show older sessions.",
    ),
  circuit: z.number().int().describe("FRM circuit group id, the same id as PowerCircuit.circuitGroupId"),
  points: z.array(HistoryPowerPointSchema).describe("Oldest first"),
});

export const HistoryPowerSchema = z.object({
  ...RangeInfo,
  series: z
    .array(HistoryPowerSeriesSchema)
    .describe("One series per (session, circuit), the series with the newest data first"),
});
export const HistoryPowerResponseSchema = snapshotEnvelope(HistoryPowerSchema);

export const HistoryItemPointSchema = z.object({
  t: z.number().int().min(0).describe("Start of the bucket, Unix ms UTC, aligned to UTC"),
  samples: z.number().int().positive().describe("How many 30-second samples the bucket holds"),
  currentPerMinute: BucketStatSchema.describe("Factory-wide production per minute, summed over every building"),
  maxPerMinute: z.number().describe("Average of the factory-wide capacity per minute over the bucket"),
});

export const HistoryItemSeriesSchema = z.object({
  item: z.string().min(1).describe("Item class name, e.g. Desc_IronPlate_C"),
  points: z.array(HistoryItemPointSchema).describe("Oldest first"),
});

export const HistoryItemsSchema = z.object({
  ...RangeInfo,
  truncated: z
    .boolean()
    .describe("true = more items exist than the cap (50): only the ones with the highest average rate are here"),
  series: z.array(HistoryItemSeriesSchema).describe("Highest average rate first"),
});
export const HistoryItemsResponseSchema = snapshotEnvelope(HistoryItemsSchema);

export const HistoryTransitionSchema = z.object({
  t: z.number().int().min(0).describe("When the machine changed state, Unix ms UTC"),
  buildingId: z.string().min(1).describe("FRM's opaque building id, only meaningful within one game session"),
  className: z.string().min(1).describe("Building class name, e.g. Build_ConstructorMk1_C"),
  fromState: z.string().nullable().describe("The state before, or null when the machine was first seen in this state"),
  toState: z.string().describe("The state after (a plain string, see FactoryBuilding.state)"),
});

export const HistoryTransitionsSchema = z.object({
  range: TransitionRangeSchema.describe("The range that was asked for"),
  from: z.number().int().min(0).describe("Start of the range, Unix ms UTC"),
  to: z.number().int().min(0).describe("End of the range (the time of the request), Unix ms UTC"),
  truncated: z.boolean().describe("true = more transitions exist in the range than `limit`"),
  transitions: z.array(HistoryTransitionSchema).describe("Newest first"),
});
export const HistoryTransitionsResponseSchema = snapshotEnvelope(HistoryTransitionsSchema);

/** Query strings (all optional, so a bare GET works): what the routes accept. */
export const HistoryPowerQuerySchema = z.object({ range: HistoryRangeSchema.default("24h") });
export const HistoryItemsQuerySchema = z.object({
  range: HistoryRangeSchema.default("24h"),
  item: z.string().min(1).max(200).optional().describe("One item's class name; omitted = the top items (cap 50)"),
});
export const HistoryTransitionsQuerySchema = z.object({
  range: TransitionRangeSchema.default("24h"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type HistoryRange = z.infer<typeof HistoryRangeSchema>;
export type TransitionRange = z.infer<typeof TransitionRangeSchema>;
export type HistoryPower = z.infer<typeof HistoryPowerSchema>;
export type HistoryPowerResponse = z.infer<typeof HistoryPowerResponseSchema>;
export type HistoryItems = z.infer<typeof HistoryItemsSchema>;
export type HistoryItemsResponse = z.infer<typeof HistoryItemsResponseSchema>;
export type HistoryTransitions = z.infer<typeof HistoryTransitionsSchema>;
export type HistoryTransitionsResponse = z.infer<typeof HistoryTransitionsResponseSchema>;
