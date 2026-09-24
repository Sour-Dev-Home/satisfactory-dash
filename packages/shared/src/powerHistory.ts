import { z } from "zod";
import { snapshotEnvelope } from "./envelope";

/** ADR-0022: the last few minutes of power readings, sampled by the backend (FRM has no
 *  history endpoint). Units and semantics follow ADR-0006 and match `PowerCircuit` in
 *  power.ts, so the chart and the live cards never disagree. */
export const PowerHistoryPointSchema = z.object({
  t: z
    .number()
    .int()
    .min(0)
    .describe("Sample time, Unix milliseconds UTC (chart-native). Points are in ascending t order."),
  productionMW: z.number().describe("Generation at the sample time, MW. Reads 0 while the fuse is tripped."),
  consumptionMW: z
    .number()
    .describe("Draw at the sample time, MW. Excludes battery charging. Reads 0 while the fuse is tripped."),
  capacityMW: z.number().describe("Generation capacity at the sample time, MW. Reads 0 while the fuse is tripped."),
  batteryPercent: z
    .number()
    .min(0)
    .describe("Battery charge at the sample time, 0-100. Meaningless when the circuit has no batteries."),
  fuseTriggered: z.boolean().describe("true = the circuit's fuse was tripped at the sample time"),
});

export const PowerHistorySeriesSchema = z.object({
  circuitGroupId: z
    .number()
    .int()
    .describe(
      "FRM circuit GROUP id, the same id as PowerCircuit.circuitGroupId. Stability across game " +
        "reloads [NEEDS VERIFICATION], so a series never spans a reload: the backend clears " +
        "the history when the session changes (ADR-0022).",
    ),
  points: z
    .array(PowerHistoryPointSchema)
    .describe(
      "Oldest first, at most windowSeconds / intervalSeconds entries. A failed poll leaves a gap " +
        "(the time between two points is more than intervalSeconds); nothing is interpolated.",
    ),
});

export const PausedRangeSchema = z.object({
  fromT: z.number().int().min(0).describe("Start of a stretch where the game was paused, Unix ms UTC"),
  toT: z
    .number()
    .int()
    .min(0)
    .describe("End of that stretch, Unix ms UTC (the latest sample while paused). fromT <= toT."),
});

export const PowerHistorySchema = z.object({
  windowSeconds: z.number().int().positive().describe("Length of the history window, seconds (5 minutes = 300)"),
  intervalSeconds: z.number().int().positive().describe("Time between samples, seconds (5)"),
  series: z
    .array(PowerHistorySeriesSchema)
    .describe("One series per circuit group seen in the window. Empty right after the backend starts or a reset."),
  pausedRanges: z
    .array(PausedRangeSchema)
    .describe(
      "Stretches inside the window where the game was paused, oldest first. Values freeze while " +
        "paused (ADR-0012), so the chart shades these instead of showing a flat line as real.",
    ),
});
export const PowerHistoryResponseSchema = snapshotEnvelope(PowerHistorySchema);

export type PowerHistoryPoint = z.infer<typeof PowerHistoryPointSchema>;
export type PowerHistorySeries = z.infer<typeof PowerHistorySeriesSchema>;
export type PausedRange = z.infer<typeof PausedRangeSchema>;
export type PowerHistory = z.infer<typeof PowerHistorySchema>;
export type PowerHistoryResponse = z.infer<typeof PowerHistoryResponseSchema>;
