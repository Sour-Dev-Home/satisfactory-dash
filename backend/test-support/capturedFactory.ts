import type { FactoryBuilding, PowerCircuit } from "../src/modules/telemetry/domain.js";

/**
 * ADR-0066 PR 3: domain-shaped test inputs for the telemetry services and routes, so no FRM-shaped data feeds them.
 * Each value is what the game adapter (packages/game-adapter, as of this PR) mapped the matching FRM fixture to,
 * committed as its output, unchanged. Those FRM fixtures are real getFactory entries reduced to the fields the adapter
 * reads (no location, no ManuSpeed, no InputInventory, so the buildings below carry none of the three).
 */

/** From docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-01-running-trimmed.json: output 100/100
 *  and IsProducing false (B1). */
export const capturedBackedUpAssembler: FactoryBuilding = {
  id: "Build_AssemblerMk1_C_2147069774",
  name: "Assembler",
  className: "Build_AssemblerMk1_C",
  recipe: "Reinforced Iron Plate",
  isProducing: false,
  isPaused: false,
  production: [{ name: "Reinforced Iron Plate", className: "Desc_IronPlateReinforced_C", currentPerMinute: 0, maxPerMinute: 5, percent: 0 }],
  consumption: [
    { name: "Iron Plate", className: "Desc_IronPlate_C", currentPerMinute: 0, maxPerMinute: 30, percent: 0 },
    { name: "Screws", className: "Desc_IronScrew_C", currentPerMinute: 0, maxPerMinute: 60, percent: 0 },
  ],
  outputInventory: [{ name: "Reinforced Iron Plate", className: "Desc_IronPlateReinforced_C", amount: 100, maxAmount: 100 }],
  circuitGroupId: 0,
  powerConsumed: 0.10000000149011612,
  maxPowerConsumed: 15,
  fuseTriggered: false,
};

/** From docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-01-running-trimmed.json: Recipe
 *  "Unassigned", IsConfigured false and a placeholder production entry (B2), which the adapter maps to no recipe and
 *  no rates. */
export const capturedUnassignedAssembler: FactoryBuilding = {
  id: "Build_AssemblerMk1_C_2145959128",
  name: "Assembler",
  className: "Build_AssemblerMk1_C",
  recipe: null,
  isProducing: false,
  isPaused: false,
  production: [],
  consumption: [],
  outputInventory: [],
  circuitGroupId: 0,
  powerConsumed: 0.10000000149011612,
  maxPowerConsumed: 15,
  fuseTriggered: false,
};

/** From docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-CJ-norecipe-fuse-trimmed.json: an
 *  unconfigured refinery on the tripped grid, circuit group 1 (FRM's CircuitID 2, B3). */
export const capturedTrippedGridRefinery: FactoryBuilding = {
  id: "Build_OilRefinery_C_2147458064",
  name: "Refinery",
  className: "Build_OilRefinery_C",
  recipe: null,
  isProducing: false,
  isPaused: false,
  production: [],
  consumption: [],
  outputInventory: [],
  circuitGroupId: 1,
  powerConsumed: 0,
  maxPowerConsumed: 30,
  fuseTriggered: true,
};

/** From docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-01-running-trimmed.json: configured and
 *  producing, fluid output slot Fuel 3.2/50 (not full). */
export const capturedFuelRefinery: FactoryBuilding = {
  id: "Build_OilRefinery_C_2146613066",
  name: "Refinery",
  className: "Build_OilRefinery_C",
  recipe: "Fuel",
  isProducing: true,
  isPaused: false,
  production: [
    { name: "Fuel", className: "Desc_LiquidFuel_C", currentPerMinute: 40, maxPerMinute: 40, percent: 100 },
    { name: "Polymer Resin", className: "Desc_PolymerResin_C", currentPerMinute: 30, maxPerMinute: 30, percent: 100 },
  ],
  consumption: [{ name: "Crude Oil", className: "Desc_LiquidOil_C", currentPerMinute: 60, maxPerMinute: 60, percent: 100 }],
  outputInventory: [{ name: "Fuel", className: "Desc_LiquidFuel_C", amount: 3.1999998092651367, maxAmount: 50 }],
  circuitGroupId: 0,
  powerConsumed: 30,
  maxPowerConsumed: 30,
  fuseTriggered: false,
};

/** From the documented example in docs-vault/raw-sources/frm-getPower.md (not a capture): one idle circuit, group 0,
 *  100 MW max consumption. */
export const documentedPowerCircuit: PowerCircuit = {
  circuitGroupId: 0,
  powerProduction: 0,
  powerConsumed: 0,
  powerCapacity: 0,
  maxPowerConsumed: 100,
  fuseTriggered: false,
  batteryPercent: 0,
  batteryDifferential: 0,
  batteryCapacity: 0,
};
