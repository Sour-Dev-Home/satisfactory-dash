import { z } from "zod";
import { snapshotEnvelope } from "./envelope";

/** Units and semantics per ADR-0006 (docs-vault/wiki/decisions/0006-units-and-semantics.md).
 *  Contract rule: `circuits` never contains placeholder rows for malformed upstream data;
 *  malformed data is an upstream_invalid_response error instead (ADR-0003). */
export const PowerCircuitStatusSchema = z
  .enum(["ok", "at_risk", "outage"])
  .describe(
    "Backend-classified. outage = fuse tripped. at_risk = consumption > capacity, or batteries " +
      "draining and below 20%. ok otherwise. The frontend never re-derives this.",
  );

export const PowerCircuitSchema = z.object({
  circuitGroupId: z
    .number()
    .int()
    .describe(
      "FRM circuit GROUP id (a power switch can join circuits into one group). Unique within one " +
        "response; stability across server restarts [NEEDS VERIFICATION], so don't persist it.",
    ),
  productionMW: z.number().describe("Current generation, MW. Reads 0 while the fuse is tripped."),
  consumptionMW: z
    .number()
    .describe("Current draw, MW. Excludes battery charging. Reads 0 while the fuse is tripped."),
  capacityMW: z.number().describe("Generation capacity, MW. Reads 0 while the fuse is tripped."),
  maxConsumptionMW: z
    .number()
    .describe("Draw if every consumer ran flat out, MW. > capacityMW means the grid could overload."),
  fuseTriggered: z.boolean().describe("true = the circuit's fuse has tripped"),
  batteryCapacityMWh: z.number().min(0).describe("Total battery storage, MWh. 0 = no batteries."),
  batteryPercent: z
    .number()
    .min(0)
    .describe("Battery charge, 0-100. Meaningless when batteryCapacityMWh is 0."),
  batteryDifferentialMW: z.number().describe("Net battery flow, MW. Positive = charging."),
  status: PowerCircuitStatusSchema,
});

export const PowerSchema = z.object({
  circuits: z.array(PowerCircuitSchema).describe("Empty when no circuits exist (e.g. a new save)."),
  hasOutage: z.boolean().describe("true if any circuit's status is outage"),
});
export const PowerResponseSchema = snapshotEnvelope(PowerSchema);

export type PowerCircuitStatus = z.infer<typeof PowerCircuitStatusSchema>;
export type PowerCircuit = z.infer<typeof PowerCircuitSchema>;
export type Power = z.infer<typeof PowerSchema>;
export type PowerResponse = z.infer<typeof PowerResponseSchema>;
