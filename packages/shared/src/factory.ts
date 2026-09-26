import { z } from "zod";
import { snapshotEnvelope } from "./envelope";

/** Units and semantics per ADR-0006 (docs-vault/wiki/decisions/0006-units-and-semantics.md). */
export const ProductionRateSchema = z.object({
  name: z.string().describe("Item display name"),
  className: z.string().describe("Item class name"),
  currentPerMinute: z
    .number()
    .min(0)
    .describe("Current rate per minute, averaged. Its unit is in `unit`; never guess it."),
  unit: z
    .enum(["items/min", "m3/min"])
    .nullable()
    .optional()
    .describe(
      "The unit of currentPerMinute and maxPerMinute, from the game's own item data (ADR-0015): " +
        "items/min for solids, m3/min for liquids and gases. Missing or null = unknown (an item " +
        "not in the backend's catalog, e.g. a modded item, or a backend that predates this field), " +
        "so the client shows just 'per minute'. Optional so a newly deployed frontend still parses " +
        "an older backend's responses (ADR-0007); current backends always send it.",
    ),
  maxPerMinute: z
    .number()
    .min(0)
    .describe("Maximum rate per minute; already includes clock speed. Somersloop effect [NEEDS VERIFICATION]."),
  percent: z
    .number()
    .min(0)
    .describe("0-100. Can slightly exceed 100 from float noise, so there is no max."),
});

/** Where a building stands in the world (ADR-0023). Metres per ADR-0006. */
export const BuildingLocationSchema = z.object({
  xM: z.number().describe("World X in metres"),
  yM: z.number().describe("World Y in metres"),
  zM: z.number().describe("World Z (height) in metres"),
  rotationDeg: z.number().min(0).lt(360).describe("Yaw in degrees, normalized to [0, 360)"),
});

export const FactoryBuildingSchema = z.object({
  id: z
    .string()
    .describe("Opaque id, unique within one response. Stability across restarts [NEEDS VERIFICATION]; don't persist it."),
  name: z.string().describe("Building display name"),
  className: z.string().describe("Building class name"),
  recipe: z.string().nullable().describe("Recipe name, or null when no recipe is configured"),
  isProducing: z
    .boolean()
    .describe("Instantaneous flag; can be false while the averaged percent is well above 0. Show percent, not this."),
  isPaused: z.boolean().describe("Machine paused by a player (standby) [NEEDS VERIFICATION]"),
  isBackedUp: z
    .boolean()
    .describe(
      "Backend-derived overflow signal: an output slot is at capacity, the machine isn't " +
        "paused, and a recipe is configured. A machine with a full output stops producing, " +
        "so this does not require isProducing. Fluid-output machines are covered; a blocked " +
        "refinery [NEEDS VERIFICATION].",
    ),
  production: z.array(ProductionRateSchema).describe("Empty when no recipe is configured"),
  ingredients: z
    .array(ProductionRateSchema)
    .optional()
    .describe(
      "What the machine consumes, mirroring `production` (ADR-0027): the same shape and the same " +
        "unit resolution, from FRM's CurrentConsumed / MaxConsumed / ConsPercent. Empty when no " +
        "recipe is configured. Optional so a newly deployed frontend still parses an older " +
        "backend's responses (ADR-0007).",
    ),
  state: z
    .string()
    .optional()
    .describe(
      "Backend-derived machine state (ADR-0027): one of \"producing\", \"idle\", \"backedUp\", " +
        "\"starved\", \"paused\", \"unpowered\". A plain string, not an enum, so a state added " +
        "later doesn't fail an already-deployed frontend's parse; treat an unknown value as " +
        "\"no state\". Omitted (never guessed) when the backend has too little data to say.",
    ),
  location: BuildingLocationSchema.optional().describe(
    "World position (ADR-0023). Optional so a newly deployed frontend still parses an older " +
      "backend's responses (ADR-0007); current backends always send it. The backend converts " +
      "FRM's centimetres to metres (docs-vault/raw-sources/world-coordinates.md; the owner's " +
      "in-game check is pending).",
  ),
  clockSpeedPercent: z
    .number()
    .optional()
    .describe(
      "The machine's configured clock speed in percent (FRM ManuSpeed; 100 = default clock, above 100 " +
        "when overclocked with power shards). Optional: omitted when FRM sent none, and so an older " +
        "backend's responses still parse (ADR-0007).",
    ),
  circuitGroupId: z
    .number()
    .int()
    .optional()
    .describe(
      "Power circuit group the building is wired to; -1 = not connected (ADR-0023). Matches " +
        "PowerCircuit.circuitGroupId from the power endpoint. Optional for the same deploy-skew reason as location.",
    ),
});

export const FactorySchema = z.object({
  buildings: z.array(FactoryBuildingSchema),
  backedUpCount: z.number().int().min(0).describe("Number of buildings with isBackedUp true"),
  stateCounts: z
    .record(z.string(), z.number().int().min(0))
    .optional()
    .describe(
      "How many buildings are in each `state` (ADR-0027), e.g. {\"producing\": 40, \"starved\": 3}, " +
        "for the Overview's \"N machines stalled\". Buildings without a state are not counted. " +
        "Optional for the same deploy-skew reason as `state`.",
    ),
});
export const FactoryResponseSchema = snapshotEnvelope(FactorySchema);

export type ProductionRate = z.infer<typeof ProductionRateSchema>;
export type FactoryBuilding = z.infer<typeof FactoryBuildingSchema>;
export type Factory = z.infer<typeof FactorySchema>;
export type FactoryResponse = z.infer<typeof FactoryResponseSchema>;
