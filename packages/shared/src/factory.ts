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
    .describe(
      "The unit of currentPerMinute and maxPerMinute, from the game's own item data (ADR-0015): " +
        "items/min for solids, m3/min for liquids and gases. null = an unknown item (not in the " +
        "backend's catalog, e.g. a modded item), so the client shows just 'per minute'.",
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
});

export const FactorySchema = z.object({
  buildings: z.array(FactoryBuildingSchema),
  backedUpCount: z.number().int().min(0).describe("Number of buildings with isBackedUp true"),
});
export const FactoryResponseSchema = snapshotEnvelope(FactorySchema);

export type ProductionRate = z.infer<typeof ProductionRateSchema>;
export type FactoryBuilding = z.infer<typeof FactoryBuildingSchema>;
export type Factory = z.infer<typeof FactorySchema>;
export type FactoryResponse = z.infer<typeof FactoryResponseSchema>;
