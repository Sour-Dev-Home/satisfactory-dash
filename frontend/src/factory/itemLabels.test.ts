import { factoryMixed, factoryUnknownItem } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it } from "vitest";
import { itemLabels, labelFor } from "./itemLabels";

describe("itemLabels", () => {
  it("names each class from the live factory, with its unit", () => {
    const labels = itemLabels(factoryMixed.data.buildings);
    expect(labels.get("Desc_LiquidFuel_C")).toEqual({ name: "Fuel", unit: "m3/min" });
  });

  it("keeps an unknown unit unknown", () => {
    expect(labelFor(itemLabels(factoryUnknownItem.data.buildings), "Desc_ExampleModdedWidget_C")).toEqual({
      name: "Modded Widget",
      unit: null,
    });
  });

  it("reads inputs too, and fills a unit any machine reports", () => {
    const [b] = factoryMixed.data.buildings;
    const input = { name: "Coal", className: "Desc_Coal_C", unit: null, currentPerMinute: 1, maxPerMinute: 1, percent: 100 };
    const labels = itemLabels([
      { ...b, production: [], ingredients: [input] },
      { ...b, production: [], ingredients: [{ ...input, unit: "items/min" }] },
    ]);
    expect(labels.get("Desc_Coal_C")).toEqual({ name: "Coal", unit: "items/min" });
  });
});

describe("labelFor", () => {
  it.each([
    ["Desc_IronPlate_C", "Iron Plate"],
    ["Desc_OreIron_C", "Ore Iron"],
    ["Desc_HeavyOilResidue_C", "Heavy Oil Residue"],
    ["Desc_Some_Mod_Item_C", "Some Mod Item"],
    ["BP_Something", "BP Something"],
    ["Desc__C", "Desc__C"],
  ])("spells an item not in today's factory, %s, as %s, with no unit", (className, name) => {
    expect(labelFor(new Map(), className)).toEqual({ name, unit: null });
  });
});
