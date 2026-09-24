import { z } from "zod";

/**
 * Runtime validation of raw vanilla-API and FRM responses (ADR-0002: raw shapes are
 * validated here, never in packages/shared). Shapes follow what each API actually
 * returns, not only what its docs say: vanilla fields are camelCase (live-confirmed,
 * docs-vault/wiki/vanilla-dedicated-server-api.md), FRM fields PascalCase, and the
 * 2026-09-22 captures settled several FRM details (docs-vault/wiki/frm-api.md).
 *
 * Every constraint the public contract asserts (packages/shared: counts, rates,
 * percents and battery values >= 0) is enforced HERE, so out-of-range upstream data
 * fails as a 502 upstream_invalid_response in the adapter and a response-contract
 * failure only ever means our own mapping bug (architect ruling on PR 1). Objects are
 * non-strict: unknown fields are stripped, not rejected, since both APIs add fields.
 */

/** Float noise below zero that live data can plausibly contain; clamped to 0, the
 *  same way values slightly above 100 are accepted. Anything more negative is invalid. */
const NEGATIVE_NOISE = 0.001;

const nonNegative = z
  .number()
  .refine((value) => value >= -NEGATIVE_NOISE, { message: "must not be negative" })
  .transform((value) => Math.max(value, 0));

const count = z.number().int().min(0);

// --- Vanilla Dedicated Server HTTPS API (the `data` of a Success Response) ---

export const RawHealthCheckResponseSchema = z.object({
  health: z.enum(["healthy", "slow"]),
  serverCustomData: z.string().optional(),
});

export const RawServerGameStateSchema = z.object({
  activeSessionName: z.string(),
  numConnectedPlayers: count,
  playerLimit: count,
  isGameRunning: z.boolean(),
  totalGameDuration: nonNegative,
  isGamePaused: z.boolean(),
  averageTickRate: nonNegative,
  // Returned but not used by the adapter; optional so a response without them is fine.
  techTier: z.number().optional(),
  activeSchematic: z.string().optional(),
  gamePhase: z.string().optional(),
  autoLoadSessionName: z.string().optional(),
  agreeToCrashUploadRequested: z.boolean().optional(),
});

export const RawQueryServerStateResponseSchema = z.object({
  serverGameState: RawServerGameStateSchema,
});

// --- FicsitRemoteMonitoring Web Server ---

export const RawFrmLocationSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  rotation: z.number().optional(),
});

export const RawFrmProductionItemSchema = z.object({
  Name: z.string(),
  ClassName: z.string(),
  // A number despite frm-getFactory.md:33 saying String (2026-09-22 captures).
  Amount: nonNegative,
  CurrentProd: nonNegative,
  MaxProd: nonNegative,
  ProdPercent: nonNegative,
});

export const RawFrmIngredientItemSchema = z.object({
  Name: z.string(),
  ClassName: z.string(),
  Amount: nonNegative,
  CurrentConsumed: nonNegative,
  MaxConsumed: nonNegative,
  ConsPercent: nonNegative,
});

export const RawFrmInventorySlotSchema = z.object({
  Name: z.string(),
  ClassName: z.string(),
  Amount: nonNegative,
  MaxAmount: nonNegative,
});

export const RawFrmPowerInfoSchema = z.object({
  CircuitGroupID: z.number().int(),
  CircuitID: z.number().int(),
  FuseTriggered: z.boolean().optional(),
  PowerConsumed: z.number(),
  MaxPowerConsumed: z.number(),
});

export const RawFrmFactoryBuildingSchema = z.object({
  ID: z.string().min(1),
  Name: z.string(),
  ClassName: z.string(),
  /** "Unassigned" (not absent) when no recipe is set; see IsConfigured. Never empty:
   *  an empty recipe would get past the adapter's unconfigured check (PR #12 review). */
  Recipe: z.string().min(1).optional(),
  /** "Is a recipe configured?" (frm-getFactory.md:57). Present on every building in
   *  the 2026-09-22 live captures, and false exactly when Recipe is "Unassigned". */
  IsConfigured: z.boolean().optional(),
  production: z.array(RawFrmProductionItemSchema).optional(),
  ingredients: z.array(RawFrmIngredientItemSchema).optional(),
  /** Non-empty slots only: FRM omits empty ones (2026-09-22 captures). */
  OutputInventory: z.array(RawFrmInventorySlotSchema).optional(),
  IsProducing: z.boolean(),
  IsPaused: z.boolean(),
  PowerInfo: RawFrmPowerInfoSchema.optional(),
  /** World position (frm-getFactory.md:23-27; units not documented, believed centimetres:
   *  ADR-0023). Optional so a building without it still maps, just without a location. */
  location: RawFrmLocationSchema.optional(),
});

export const RawFrmPowerCircuitSchema = z.object({
  CircuitGroupID: z.number().int(),
  PowerProduction: z.number(),
  PowerConsumed: z.number(),
  PowerCapacity: z.number(),
  PowerMaxConsumed: z.number(),
  /** MW, positive = charging (live-confirmed). */
  BatteryDifferential: z.number(),
  /** 0-100 (live-confirmed). */
  BatteryPercent: nonNegative,
  /** MWh; 0 = no batteries. */
  BatteryCapacity: nonNegative,
  FuseTriggered: z.boolean(),
  // Returned but not used by the adapter.
  BatteryInput: z.number().optional(),
  BatteryOutput: z.number().optional(),
  BatteryTimeEmpty: z.string().optional(),
  BatteryTimeFull: z.string().optional(),
  AssociatedCircuits: z.array(z.number().int()).optional(),
});

/** The whole getPower body. getPower reports circuit GROUPS, and the public contract
 *  promises circuitGroupId is unique within one response, so a repeated id is a
 *  malformed response (found by PR #22's fresh-eyes review). */
export const RawFrmPowerResponseSchema = z.array(RawFrmPowerCircuitSchema).superRefine((circuits, ctx) => {
  const seen = new Set<number>();
  circuits.forEach((circuit, index) => {
    if (seen.has(circuit.CircuitGroupID)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "CircuitGroupID"],
        message: `duplicate circuit group id ${circuit.CircuitGroupID}`,
      });
    }
    seen.add(circuit.CircuitGroupID);
  });
});

export const RawFrmPowerUsageBuildingSchema = z.object({
  ID: z.string().min(1),
  Name: z.string(),
  ClassName: z.string(),
  PowerInfo: RawFrmPowerInfoSchema,
});

export const RawFrmPlayerSchema = z.object({
  ID: z.string(),
  Name: z.string(),
  location: RawFrmLocationSchema,
  PlayerHP: z.number(),
  Online: z.boolean(),
  Dead: z.boolean(),
});

export const RawFrmSessionInfoSchema = z.object({
  SessionName: z.string(),
  IsPaused: z.boolean(),
  DayLength: z.number(),
  NightLength: z.number(),
  PassedDays: z.number(),
  IsDay: z.boolean(),
  TotalPlayDuration: nonNegative,
});
