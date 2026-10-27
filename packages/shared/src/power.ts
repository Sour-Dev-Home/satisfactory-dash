import { z } from "zod";
import { snapshotEnvelope } from "./envelope";
import { BuildingLocationSchema } from "./factory";

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
  productionMW: z
    .number()
    .describe(
      "Total produced, MW, as the in-game graph's Produced; on the FRM path derived as max(base production, " +
        "consumption) [NEEDS VERIFICATION with batteries]. Reads 0 while the fuse is tripped.",
    ),
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

/** An item in a generator's fuel or supplement slot (S4-B). */
export const GeneratorItemSchema = z.object({
  className: z.string().describe("Item class name"),
  name: z.string().describe("Item display name"),
  amount: z.number().min(0).describe("How much is in the slot: items for a solid, m³ for a fluid (see `unit`)"),
  unit: z
    .enum(["items", "m3"])
    .nullable()
    .optional()
    .describe("Backend-derived from the item catalog (ADR-0015), as a rate's unit; absent or null = unknown"),
});

/** One generator (S4-B, ADR-0058): what it makes now and what it burns. Units per ADR-0006. */
export const PowerGeneratorSchema = z.object({
  id: z.string().describe("Opaque id, unique within one response; the same id space as factory buildings. Don't persist it."),
  name: z.string().describe("Building display name, e.g. \"Coal-Powered Generator\""),
  className: z.string().describe("Building class name"),
  location: BuildingLocationSchema.optional().describe("World position in metres (ADR-0023)"),
  circuitGroupId: z.number().int().optional().describe("The power circuit group it feeds; -1 = not connected. Matches PowerCircuit.circuitGroupId"),
  currentMW: z.number().min(0).describe("Power produced now, MW"),
  capacityMW: z.number().min(0).describe("What it can produce at its current clock speed, MW"),
  clockSpeedPercent: z.number().min(0).optional().describe("Configured clock speed in percent; 100 = default"),
  isProducing: z.boolean().describe("Instantaneous flag: producing power this tick"),
  fuel: GeneratorItemSchema.nullable().describe("The item in the fuel slot; null when empty or when it takes no fuel (geothermal)"),
  supplement: GeneratorItemSchema.nullable()
    .optional()
    .describe("The supplement (water for coal and nuclear); null when it takes none or holds none; absent = not read"),
});

export const PowerSchema = z.object({
  circuits: z.array(PowerCircuitSchema).describe("Empty when no circuits exist (e.g. a new save)."),
  hasOutage: z.boolean().describe("true if any circuit's status is outage"),
  generators: z
    .array(PowerGeneratorSchema)
    .optional()
    .describe(
      "S4-B: every generator, with its output and fuel. Absent = a sender that does not read generators (the FRM agent) " +
        "or an older backend (ADR-0007); an empty array means none were found.",
    ),
});
export const PowerResponseSchema = snapshotEnvelope(PowerSchema);

export type PowerCircuitStatus = z.infer<typeof PowerCircuitStatusSchema>;
export type PowerCircuit = z.infer<typeof PowerCircuitSchema>;
export type Power = z.infer<typeof PowerSchema>;
export type GeneratorItem = z.infer<typeof GeneratorItemSchema>;
export type PowerGenerator = z.infer<typeof PowerGeneratorSchema>;
export type PowerResponse = z.infer<typeof PowerResponseSchema>;
