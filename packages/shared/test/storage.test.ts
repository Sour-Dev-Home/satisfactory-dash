import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  SnapshotRequestSchema,
  STORAGE_MAX_CONTAINERS,
  STORAGE_MAX_ITEMS_PER_CONTAINER,
  StorageResponseSchema,
  StorageSchema,
} from "../src/index";

// ADR-0058 Sprint S4-B, item 4: storage contents as a snapshot part.

const ironPlate = { className: "Desc_IronPlate_C", name: "Iron Plate", amount: 1_200, stackMax: 200 };
const container = {
  id: "Build_StorageContainerMk2_C_1",
  name: "Industrial Storage Container",
  className: "Build_StorageContainerMk2_C",
  location: { xM: 1, yM: 2, zM: 3, rotationDeg: 90 },
  slots: 48,
  slotsUsed: 6,
  items: [ironPlate],
};
const buffer = {
  id: "Build_PipeStorageTank_C_1",
  name: "Fluid Buffer",
  className: "Build_PipeStorageTank_C",
  slots: 0,
  slotsUsed: 0,
  fluidCapacityM3: 400,
  items: [{ className: "Desc_Water_C", name: "Water", amount: 312.5, stackMax: null }],
};
const full = fixtures.agentSnapshotRequestFull;
const ok = (storage: object | undefined) => SnapshotRequestSchema.safeParse({ ...full, storage }).success;
const many = <T,>(item: T, n: number) => Array.from({ length: n }, () => item);

describe("S4-B storage contents", () => {
  it("is optional in a snapshot: an older sender, or the FRM agent, sends none", () => {
    expect(ok(undefined)).toBe(true);
    expect(ok({ containers: [] })).toBe(true);
    expect(ok({ containers: [container, buffer, { ...container, slotsUsed: 0, items: [] }] })).toBe(true);
  });

  it("is a data part, so an unreachable snapshot may not carry it", () => {
    const unreachable = { agentVersion: full.agentVersion, observedAt: full.observedAt, reachable: false, paused: null };
    expect(SnapshotRequestSchema.safeParse(unreachable).success).toBe(true);
    expect(SnapshotRequestSchema.safeParse({ ...unreachable, storage: { containers: [] } }).success).toBe(false);
  });

  it(`caps containers at ${STORAGE_MAX_CONTAINERS} and item classes at ${STORAGE_MAX_ITEMS_PER_CONTAINER} per container`, () => {
    const small = { ...container, items: [] };
    expect(ok({ containers: many(small, STORAGE_MAX_CONTAINERS) })).toBe(true);
    expect(ok({ containers: many(small, STORAGE_MAX_CONTAINERS + 1) })).toBe(false);
    expect(ok({ containers: [{ ...container, items: many(ironPlate, STORAGE_MAX_ITEMS_PER_CONTAINER) }] })).toBe(true);
    expect(ok({ containers: [{ ...container, items: many(ironPlate, STORAGE_MAX_ITEMS_PER_CONTAINER + 1) }] })).toBe(false);
  });

  it("bounds strings at 200 and refuses negative or non-finite numbers", () => {
    for (const field of ["id", "name", "className"]) {
      expect(ok({ containers: [{ ...container, [field]: "x".repeat(200) }] }), `${field} 200`).toBe(true);
      expect(ok({ containers: [{ ...container, [field]: "x".repeat(201) }] }), `${field} 201`).toBe(false);
    }
    expect(ok({ containers: [{ ...container, items: [{ ...ironPlate, name: "x".repeat(201) }] }] })).toBe(false);
    expect(ok({ containers: [{ ...container, items: [{ ...ironPlate, amount: -1 }] }] })).toBe(false);
    expect(ok({ containers: [{ ...container, items: [{ ...ironPlate, amount: Number.NaN }] }] })).toBe(false);
    expect(ok({ containers: [{ ...container, slots: 1.5 }] })).toBe(false);
    expect(ok({ containers: [{ ...buffer, fluidCapacityM3: -1 }] })).toBe(false);
  });

  it("drops a sender's unit (the backend derives it); the response carries it, unbounded", () => {
    const parsed = SnapshotRequestSchema.parse({ ...full, storage: { containers: [{ ...container, items: [{ ...ironPlate, unit: "items" }] }] } });
    expect(parsed.storage?.containers[0]?.items[0]).not.toHaveProperty("unit");
    const response = { containers: [{ ...container, className: "x".repeat(300), items: [{ ...ironPlate, unit: "items" }] }, buffer] };
    expect(StorageSchema.safeParse(response).success).toBe(true);
    const envelope = { ...fixtures.factoryMixed, data: response };
    expect(StorageResponseSchema.safeParse(envelope).success).toBe(true);
  });
});
