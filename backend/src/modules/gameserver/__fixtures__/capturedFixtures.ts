import type { RawFrmFactoryBuilding } from "../rawTypes.js";

// Real getFactory entries from the 2026-09-22 captures in
// docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-*-trimmed.json,
// reduced to the fields the adapter reads (location, BoundingBox, etc. dropped). Values
// are copied unchanged.

/** 01-running: output 100/100 and IsProducing false (B1) */
export const capturedBackedUpAssembler: RawFrmFactoryBuilding = {
  ID: "Build_AssemblerMk1_C_2147069774",
  Name: "Assembler",
  ClassName: "Build_AssemblerMk1_C",
  Recipe: "Reinforced Iron Plate",
  IsConfigured: true,
  production: [
    {
      Name: "Reinforced Iron Plate",
      ClassName: "Desc_IronPlateReinforced_C",
      Amount: 1,
      CurrentProd: 0,
      MaxProd: 5,
      ProdPercent: 0
    }
  ],
  ingredients: [
    {
      Name: "Iron Plate",
      ClassName: "Desc_IronPlate_C",
      Amount: 6,
      CurrentConsumed: 0,
      MaxConsumed: 30,
      ConsPercent: 0
    },
    {
      Name: "Screws",
      ClassName: "Desc_IronScrew_C",
      Amount: 12,
      CurrentConsumed: 0,
      MaxConsumed: 60,
      ConsPercent: 0
    }
  ],
  OutputInventory: [
    {
      Name: "Reinforced Iron Plate",
      ClassName: "Desc_IronPlateReinforced_C",
      Amount: 100,
      MaxAmount: 100
    }
  ],
  IsProducing: false,
  IsPaused: false,
  PowerInfo: {
    CircuitGroupID: 0,
    CircuitID: 0,
    FuseTriggered: false,
    PowerConsumed: 0.10000000149011612,
    MaxPowerConsumed: 15
  }
};

/** 01-running: Recipe "Unassigned", IsConfigured false, placeholder production entry (B2) */
export const capturedUnassignedAssembler: RawFrmFactoryBuilding = {
  ID: "Build_AssemblerMk1_C_2145959128",
  Name: "Assembler",
  ClassName: "Build_AssemblerMk1_C",
  Recipe: "Unassigned",
  IsConfigured: false,
  production: [
    {
      Name: "Unassigned",
      ClassName: "Unassigned",
      Amount: 0,
      CurrentProd: 0,
      MaxProd: 0,
      ProdPercent: 0
    }
  ],
  ingredients: [
    {
      Name: "Unassigned",
      ClassName: "Unassigned",
      Amount: 0,
      CurrentConsumed: 0,
      MaxConsumed: 0,
      ConsPercent: 0
    }
  ],
  OutputInventory: [],
  IsProducing: false,
  IsPaused: false,
  PowerInfo: {
    CircuitGroupID: 0,
    CircuitID: 0,
    FuseTriggered: false,
    PowerConsumed: 0.10000000149011612,
    MaxPowerConsumed: 15
  }
};

/** CJ: unconfigured refinery on the tripped grid, CircuitGroupID 1 vs CircuitID 2 (B3) */
export const capturedTrippedGridRefinery: RawFrmFactoryBuilding = {
  ID: "Build_OilRefinery_C_2147458064",
  Name: "Refinery",
  ClassName: "Build_OilRefinery_C",
  Recipe: "Unassigned",
  IsConfigured: false,
  production: [
    {
      Name: "Unassigned",
      ClassName: "Unassigned",
      Amount: 0,
      CurrentProd: 0,
      MaxProd: 0,
      ProdPercent: 0
    }
  ],
  ingredients: [
    {
      Name: "Unassigned",
      ClassName: "Unassigned",
      Amount: 0,
      CurrentConsumed: 0,
      MaxConsumed: 0,
      ConsPercent: 0
    }
  ],
  OutputInventory: [],
  IsProducing: false,
  IsPaused: false,
  PowerInfo: {
    CircuitGroupID: 1,
    CircuitID: 2,
    FuseTriggered: true,
    PowerConsumed: 0,
    MaxPowerConsumed: 30
  }
};

/** 01-running: configured, producing, fluid output slot Fuel 3.2/50 (not full) */
export const capturedFuelRefinery: RawFrmFactoryBuilding = {
  ID: "Build_OilRefinery_C_2146613066",
  Name: "Refinery",
  ClassName: "Build_OilRefinery_C",
  Recipe: "Fuel",
  IsConfigured: true,
  production: [
    {
      Name: "Fuel",
      ClassName: "Desc_LiquidFuel_C",
      Amount: 4,
      CurrentProd: 40,
      MaxProd: 40,
      ProdPercent: 100
    },
    {
      Name: "Polymer Resin",
      ClassName: "Desc_PolymerResin_C",
      Amount: 3,
      CurrentProd: 30,
      MaxProd: 30,
      ProdPercent: 100
    }
  ],
  ingredients: [
    {
      Name: "Crude Oil",
      ClassName: "Desc_LiquidOil_C",
      Amount: 6,
      CurrentConsumed: 60,
      MaxConsumed: 60,
      ConsPercent: 100
    }
  ],
  OutputInventory: [
    {
      Name: "Fuel",
      ClassName: "Desc_LiquidFuel_C",
      Amount: 3.1999998092651367,
      MaxAmount: 50
    }
  ],
  IsProducing: true,
  IsPaused: false,
  PowerInfo: {
    CircuitGroupID: 0,
    CircuitID: 0,
    FuseTriggered: false,
    PowerConsumed: 30,
    MaxPowerConsumed: 30
  }
};
