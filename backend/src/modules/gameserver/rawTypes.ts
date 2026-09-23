/**
 * Raw response shapes as actually returned by each API, not as the docs describe
 * them. Private to this directory — only satisfactoryServerAdapter.ts should import
 * these; everything else uses domain.ts.
 *
 * Derived from the runtime schemas in rawSchemas.ts, so the type and the validation
 * can't drift apart. See that file for the shape notes (vanilla camelCase, FRM
 * PascalCase, and what the 2026-09-22 captures settled).
 */
import type { z } from "zod";
import type {
  RawHealthCheckResponseSchema,
  RawServerGameStateSchema,
  RawQueryServerStateResponseSchema,
  RawFrmLocationSchema,
  RawFrmProductionItemSchema,
  RawFrmIngredientItemSchema,
  RawFrmInventorySlotSchema,
  RawFrmPowerInfoSchema,
  RawFrmFactoryBuildingSchema,
  RawFrmPowerCircuitSchema,
  RawFrmPowerUsageBuildingSchema,
  RawFrmPlayerSchema,
  RawFrmSessionInfoSchema,
} from "./rawSchemas.js";

// --- Vanilla Dedicated Server HTTPS API ---
export type RawHealthCheckResponse = z.infer<typeof RawHealthCheckResponseSchema>;
export type RawServerGameState = z.infer<typeof RawServerGameStateSchema>;
export type RawQueryServerStateResponse = z.infer<typeof RawQueryServerStateResponseSchema>;

// --- FicsitRemoteMonitoring Web Server ---
export type RawFrmLocation = z.infer<typeof RawFrmLocationSchema>;
export type RawFrmProductionItem = z.infer<typeof RawFrmProductionItemSchema>;
export type RawFrmIngredientItem = z.infer<typeof RawFrmIngredientItemSchema>;
export type RawFrmInventorySlot = z.infer<typeof RawFrmInventorySlotSchema>;
export type RawFrmPowerInfo = z.infer<typeof RawFrmPowerInfoSchema>;
export type RawFrmFactoryBuilding = z.infer<typeof RawFrmFactoryBuildingSchema>;
export type RawFrmPowerCircuit = z.infer<typeof RawFrmPowerCircuitSchema>;
export type RawFrmPowerUsageBuilding = z.infer<typeof RawFrmPowerUsageBuildingSchema>;
export type RawFrmPlayer = z.infer<typeof RawFrmPlayerSchema>;
export type RawFrmSessionInfo = z.infer<typeof RawFrmSessionInfoSchema>;
