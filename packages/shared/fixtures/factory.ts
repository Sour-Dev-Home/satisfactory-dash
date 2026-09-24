import type { FactoryBuilding, FactoryResponse } from "../src/index";

// Buildings from the 2026-09-22 capture (docs-vault/raw-sources/captured-responses/
// frm-getFactory-2026-09-22-01-running-trimmed.json), mapped the way the contract
// defines them: recipe null + no production when unconfigured, and isBackedUp from a
// full output slot regardless of isProducing (bugs B2 and B1, not yet fixed in the
// backend as of this fixture).

/** Output 100/100, IsProducing false: backed up. */
const backedUpAssembler = {
  id: "Build_AssemblerMk1_C_2147069774",
  name: "Assembler",
  className: "Build_AssemblerMk1_C",
  recipe: "Reinforced Iron Plate",
  isProducing: false,
  isPaused: false,
  isBackedUp: true,
  production: [
    {
      name: "Reinforced Iron Plate",
      className: "Desc_IronPlateReinforced_C",
      unit: "items/min",
      currentPerMinute: 0,
      maxPerMinute: 5,
      percent: 0,
    },
  ],
} satisfies FactoryBuilding;

/** IsProducing false while the averaged percent is above 0; output 98/100, not full. */
const partialAssembler = {
  id: "Build_AssemblerMk1_C_2147397136",
  name: "Assembler",
  className: "Build_AssemblerMk1_C",
  recipe: "Alternate: Coated Iron Canister",
  isProducing: false,
  isPaused: false,
  isBackedUp: false,
  production: [
    {
      name: "Empty Canister",
      className: "Desc_FluidCanister_C",
      unit: "items/min", // the empty canister is a solid item, despite the name
      currentPerMinute: 5.647059440612793,
      maxPerMinute: 60,
      percent: 9.411765734354654,
    },
  ],
} satisfies FactoryBuilding;

/** 160% clock: maxPerMinute 8 (5 at 100%), output full, so backed up. */
const overclockedStator = {
  id: "Build_AssemblerMk1_C_2147356083",
  name: "Assembler",
  className: "Build_AssemblerMk1_C",
  recipe: "Stator",
  isProducing: false,
  isPaused: false,
  isBackedUp: true,
  production: [
    {
      name: "Stator",
      className: "Desc_Stator_C",
      unit: "items/min",
      currentPerMinute: 1.9764708280563354,
      maxPerMinute: 8,
      percent: 24.705885350704193,
    },
  ],
} satisfies FactoryBuilding;

/** FRM sends Recipe "Unassigned" + a placeholder production entry; the contract says null + []. */
const unconfiguredAssembler = {
  id: "Build_AssemblerMk1_C_2145959128",
  name: "Assembler",
  className: "Build_AssemblerMk1_C",
  recipe: null,
  isProducing: false,
  isPaused: false,
  isBackedUp: false,
  production: [],
} satisfies FactoryBuilding;

/** Two outputs, fluid (Fuel, m3/min) and solid (Polymer Resin); matches the in-game refinery UI. */
const fuelRefinery = {
  id: "Build_OilRefinery_C_2146613066",
  name: "Refinery",
  className: "Build_OilRefinery_C",
  recipe: "Fuel",
  isProducing: true,
  isPaused: false,
  isBackedUp: false,
  production: [
    {
      name: "Fuel",
      className: "Desc_LiquidFuel_C",
      unit: "m3/min",
      currentPerMinute: 40,
      maxPerMinute: 40,
      percent: 100,
    },
    {
      name: "Polymer Resin",
      className: "Desc_PolymerResin_C",
      unit: "items/min", // RF_SOLID in the game data (ADR-0015)
      currentPerMinute: 30,
      maxPerMinute: 30,
      percent: 100,
    },
  ],
} satisfies FactoryBuilding;

export const factoryMixed = {
  serverId: "default",
  observedAt: "2026-09-22T22:25:04.000Z",
  stale: false,
  data: {
    buildings: [backedUpAssembler, partialAssembler, overclockedStator, unconfiguredAssembler, fuelRefinery],
    backedUpCount: 2,
  },
} satisfies FactoryResponse;

/** SYNTHETIC: an item that isn't in the backend's catalog (e.g. a modded item), so `unit` is
 *  null and the client shows just "per minute" (ADR-0015). */
export const factoryUnknownItem = {
  serverId: "default",
  observedAt: "2026-09-22T22:25:04.000Z",
  stale: false,
  data: {
    buildings: [
      {
        id: "Build_ConstructorMk1_C_2140000001",
        name: "Constructor",
        className: "Build_ConstructorMk1_C",
        recipe: "Modded Widget",
        isProducing: true,
        isPaused: false,
        isBackedUp: false,
        production: [
          {
            name: "Modded Widget",
            className: "Desc_ExampleModdedWidget_C",
            unit: null,
            currentPerMinute: 10,
            maxPerMinute: 10,
            percent: 100,
          },
        ],
      },
    ],
    backedUpCount: 0,
  },
} satisfies FactoryResponse;

/** SYNTHETIC: what a backend that predates `unit` sends (the field is absent), so a newly
 *  deployed frontend must still parse it and show just "per minute" (ADR-0007). */
export const factoryOldBackend = {
  serverId: "default",
  observedAt: "2026-09-22T22:25:04.000Z",
  stale: false,
  data: {
    buildings: [
      {
        id: "Build_ConstructorMk1_C_2140000002",
        name: "Constructor",
        className: "Build_ConstructorMk1_C",
        recipe: "Iron Plate",
        isProducing: true,
        isPaused: false,
        isBackedUp: false,
        production: [
          { name: "Iron Plate", className: "Desc_IronPlate_C", currentPerMinute: 20, maxPerMinute: 20, percent: 100 },
        ],
      },
    ],
    backedUpCount: 0,
  },
} satisfies FactoryResponse;

export const factoryEmpty = {
  serverId: "default",
  observedAt: "2026-09-22T22:25:04.000Z",
  stale: false,
  data: { buildings: [], backedUpCount: 0 },
} satisfies FactoryResponse;
