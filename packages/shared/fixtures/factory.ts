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
  location: { xM: -436, yM: -1439, zM: 118.000087890625, rotationDeg: 180 },
  circuitGroupId: 0,
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
  location: { xM: -400, yM: -1488, zM: 82.0001171875, rotationDeg: 180 },
  circuitGroupId: 0,
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
  location: { xM: 582, yM: -619, zM: 140, rotationDeg: 90 },
  circuitGroupId: 0,
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
  location: { xM: -1957, yM: -1056, zM: 86, rotationDeg: 90 },
  circuitGroupId: 0,
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
  location: { xM: -328, yM: -1909, zM: 48.0000439453125, rotationDeg: 180 },
  circuitGroupId: 0,
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

/** A rate with `percent` derived from current and max (invented numbers only). */
const rate = (name: string, className: string, unit: "items/min" | "m3/min", current: number, max: number) => ({
  name,
  className,
  unit,
  currentPerMinute: current,
  maxPerMinute: max,
  percent: (current / max) * 100,
});

/** SYNTHETIC (invented ids and numbers): for the Factory view's Ingredients and State colours. Nine machines:
 *  every backend-derived state (producing, idle, backedUp, underfed, paused, unpowered), a state this frontend
 *  has never heard of (a newer backend), a machine without `state`, and a machine with neither `ingredients` nor
 *  `state` (an older backend, ADR-0007) next to one whose `ingredients` is an empty array (no recipe).
 *  Ingredients cover a solid and a fluid input (the Packager). `stateCounts` counts what the backend would send,
 *  so the machines without `state` are not in it. */
export const factoryStatesAndIngredients = {
  serverId: "default",
  observedAt: "2026-09-25T12:00:00.000Z",
  stale: false,
  data: {
    buildings: [
      {
        id: "Build_ConstructorMk1_C_2149000001",
        name: "Constructor",
        className: "Build_ConstructorMk1_C",
        recipe: "Iron Plate",
        isProducing: true,
        isPaused: false,
        isBackedUp: false,
        circuitGroupId: 0,
        production: [rate("Iron Plate", "Desc_IronPlate_C", "items/min", 20, 20)],
        ingredients: [rate("Iron Ingot", "Desc_IronIngot_C", "items/min", 30, 30)],
        state: "producing",
      },
      {
        // Solid AND fluid input: a Packager's Fuel (m3/min) and Empty Canister (items/min). Input-limited.
        id: "Build_Packager_C_2149000002",
        name: "Packager",
        className: "Build_Packager_C",
        recipe: "Packaged Fuel",
        isProducing: true,
        isPaused: false,
        isBackedUp: false,
        circuitGroupId: 0,
        production: [rate("Packaged Fuel", "Desc_Fuel_C", "items/min", 24, 60)],
        ingredients: [
          rate("Fuel", "Desc_LiquidFuel_C", "m3/min", 24, 60),
          rate("Empty Canister", "Desc_FluidCanister_C", "items/min", 24, 60),
        ],
        state: "underfed",
      },
      {
        // No recipe: `ingredients` is an EMPTY array (the backend sends [] when nothing is configured).
        id: "Build_AssemblerMk1_C_2149000003",
        name: "Assembler",
        className: "Build_AssemblerMk1_C",
        recipe: null,
        isProducing: false,
        isPaused: false,
        isBackedUp: false,
        circuitGroupId: 0,
        production: [],
        ingredients: [],
        state: "idle",
      },
      {
        id: "Build_ConstructorMk1_C_2149000004",
        name: "Constructor",
        className: "Build_ConstructorMk1_C",
        recipe: "Screw",
        isProducing: false,
        isPaused: false,
        isBackedUp: true,
        circuitGroupId: 0,
        production: [rate("Screw", "Desc_IronScrew_C", "items/min", 0, 40)],
        ingredients: [rate("Iron Rod", "Desc_IronRod_C", "items/min", 0, 10)],
        state: "backedUp",
      },
      {
        id: "Build_SmelterMk1_C_2149000005",
        name: "Smelter",
        className: "Build_SmelterMk1_C",
        recipe: "Copper Ingot",
        isProducing: false,
        isPaused: true,
        isBackedUp: false,
        circuitGroupId: 0,
        production: [rate("Copper Ingot", "Desc_CopperIngot_C", "items/min", 0, 30)],
        ingredients: [rate("Copper Ore", "Desc_OreCopper_C", "items/min", 0, 30)],
        state: "paused",
      },
      {
        id: "Build_ConstructorMk1_C_2149000006",
        name: "Constructor",
        className: "Build_ConstructorMk1_C",
        recipe: "Wire",
        isProducing: false,
        isPaused: false,
        isBackedUp: false,
        circuitGroupId: -1, // not connected to any power circuit
        production: [rate("Wire", "Desc_Wire_C", "items/min", 0, 45)],
        ingredients: [rate("Copper Ingot", "Desc_CopperIngot_C", "items/min", 0, 15)],
        state: "unpowered",
      },
      {
        // A state a newer backend might send: the frontend must treat an unknown value as neutral.
        id: "Build_ManufacturerMk1_C_2149000007",
        name: "Manufacturer",
        className: "Build_ManufacturerMk1_C",
        recipe: "Computer",
        isProducing: true,
        isPaused: false,
        isBackedUp: false,
        circuitGroupId: 0,
        production: [rate("Computer", "Desc_Computer_C", "items/min", 2.5, 2.5)],
        ingredients: [rate("Circuit Board", "Desc_CircuitBoard_C", "items/min", 10, 10)],
        state: "overclocking-ish",
      },
      {
        // The backend had too little data to say (never guessed): no `state` at all.
        id: "Build_AssemblerMk1_C_2149000008",
        name: "Assembler",
        className: "Build_AssemblerMk1_C",
        recipe: "Rotor",
        isProducing: true,
        isPaused: false,
        isBackedUp: false,
        circuitGroupId: 0,
        production: [rate("Rotor", "Desc_Rotor_C", "items/min", 4, 4)],
        ingredients: [rate("Iron Rod", "Desc_IronRod_C", "items/min", 20, 20), rate("Screw", "Desc_IronScrew_C", "items/min", 100, 100)],
      },
      {
        // An older backend: neither `ingredients` nor `state` exists yet (ADR-0007 deploy skew).
        id: "Build_ConstructorMk1_C_2149000009",
        name: "Constructor",
        className: "Build_ConstructorMk1_C",
        recipe: "Concrete",
        isProducing: true,
        isPaused: false,
        isBackedUp: false,
        circuitGroupId: 0,
        production: [rate("Concrete", "Desc_Cement_C", "items/min", 15, 15)],
      },
    ],
    backedUpCount: 1,
    stateCounts: { producing: 1, underfed: 1, idle: 1, backedUp: 1, paused: 1, unpowered: 1, "overclocking-ish": 1 },
  },
} satisfies FactoryResponse;

export const factoryEmpty = {
  serverId: "default",
  observedAt: "2026-09-22T22:25:04.000Z",
  stale: false,
  data: { buildings: [], backedUpCount: 0 },
} satisfies FactoryResponse;
