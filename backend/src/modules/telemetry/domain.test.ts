import { describe, it, expectTypeOf } from "vitest";
import type * as Adapter from "../gameserver/index.js";
import type { BuildingPowerUsage, FactoryBuilding, InventorySlot, PowerCircuit, ProductionRate } from "./domain.js";

// ADR-0066 PR 3: while the polled path exists, its adapter's types must stay the same as telemetry's domain types, so
// the adapter's output passes into the telemetry services unconverted. Checked at compile time (npm run typecheck).
describe("telemetry domain types match the adapter's while both exist", () => {
  it("are the same types", () => {
    expectTypeOf<FactoryBuilding>().toEqualTypeOf<Adapter.FactoryBuilding>();
    expectTypeOf<PowerCircuit>().toEqualTypeOf<Adapter.PowerCircuit>();
    expectTypeOf<BuildingPowerUsage>().toEqualTypeOf<Adapter.BuildingPowerUsage>();
    expectTypeOf<InventorySlot>().toEqualTypeOf<Adapter.InventorySlot>();
    expectTypeOf<ProductionRate>().toEqualTypeOf<Adapter.ProductionRate>();
  });
});
