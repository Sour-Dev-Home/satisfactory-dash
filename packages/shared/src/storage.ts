import { z } from "zod";
import { snapshotEnvelope } from "./envelope";
import { BuildingLocationSchema } from "./factory";

/**
 * Storage contents (ADR-0058 Sprint S4-B, item 4): what every container holds now. A snapshot part, never a world layer,
 * because the amounts change every read. Only the mod sends it; the Node agent is frozen on FRM (ADR-0058 Decision 5).
 * Designed from the mod's request and the getStorageInv capture in `raw-sources/frm-s4-captures-2026-10-27/`.
 *
 * Containers are storage containers, industrial containers, personal boxes, dimensional depot uploaders and fluid
 * buffers (pipe reservoirs). A fluid buffer has no slots: `slots` and `slotsUsed` are 0, its one item is the fluid in m³
 * and `fluidCapacityM3` is its size. Units per ADR-0006.
 */
export const STORAGE_MAX_CONTAINERS = 2_000;
export const STORAGE_MAX_ITEMS_PER_CONTAINER = 64;

export const StorageItemSchema = z.object({
  className: z.string().describe("Item class name"),
  name: z.string().describe("Item display name"),
  amount: z.number().min(0).describe("How much the container holds, merged across its slots: items for a solid, m³ for a fluid"),
  stackMax: z.number().int().min(0).nullable().optional().describe("Items per full stack; null for a fluid; absent = not read"),
  unit: z
    .enum(["items", "m3"])
    .nullable()
    .optional()
    .describe("Backend-derived from the item catalog (ADR-0015), as a rate's unit; absent or null = unknown. A sender's is dropped"),
});

export const StorageContainerSchema = z.object({
  id: z.string().describe("Opaque id, unique within one response; the same id space as factory buildings. Don't persist it."),
  name: z.string().describe("Building display name, e.g. \"Industrial Storage Container\""),
  className: z.string().describe("Building class name"),
  location: BuildingLocationSchema.optional().describe("World position in metres (ADR-0023)"),
  slots: z.number().int().min(0).describe("Inventory slots; 0 for a fluid buffer"),
  slotsUsed: z.number().int().min(0).describe("Slots holding anything; 0 for a fluid buffer"),
  fluidCapacityM3: z.number().min(0).optional().describe("A fluid buffer's size in m³; absent for an item container"),
  items: z.array(StorageItemSchema).describe("One entry per item class held, merged across slots; empty when the container is empty"),
});

export const StorageSchema = z.object({
  containers: z.array(StorageContainerSchema).describe("Every storage container and fluid buffer; empty when there are none"),
});
export const StorageResponseSchema = snapshotEnvelope(StorageSchema);

export type StorageItem = z.infer<typeof StorageItemSchema>;
export type StorageContainer = z.infer<typeof StorageContainerSchema>;
export type Storage = z.infer<typeof StorageSchema>;
export type StorageResponse = z.infer<typeof StorageResponseSchema>;
