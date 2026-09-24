import { describe, it, expect } from "vitest";
import { decodeDocsFile, parseItemForms } from "./parseGameDocs.js";
import { createUnitResolver, itemFormCatalog } from "./itemForms.js";

// ADR-0015. The Docs file shape: an array of { NativeClass, Classes[] }, each class with
// a ClassName and (for items) an mForm of RF_SOLID, RF_LIQUID or RF_GAS; RF_INVALID is
// a non-item.
const docs = [
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGItemDescriptor'",
    Classes: [
      { ClassName: "Desc_Stator_C", mForm: "RF_SOLID", mDisplayName: "Stator" },
      { ClassName: "Desc_LiquidFuel_C", mForm: "RF_LIQUID" },
      { ClassName: "Desc_NitrogenGas_C", mForm: "RF_GAS" },
      { ClassName: "Desc_WorkBench_C", mForm: "RF_INVALID" },
      { ClassName: "Desc_NoForm_C" },
    ],
  },
];

describe("decodeDocsFile", () => {
  const text = JSON.stringify(docs);

  it("decodes UTF-16LE with a BOM, the game's format", () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(JSON.parse(decodeDocsFile(bytes))).toEqual(docs);
  });

  it("also accepts UTF-8, with or without a BOM", () => {
    expect(JSON.parse(decodeDocsFile(Buffer.from(text, "utf8")))).toEqual(docs);
    expect(JSON.parse(decodeDocsFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")])))).toEqual(docs);
  });
});

describe("parseItemForms", () => {
  it("maps RF_SOLID to solid, and RF_LIQUID and RF_GAS both to fluid", () => {
    expect(parseItemForms(docs)).toEqual({
      Desc_Stator_C: "solid",
      Desc_LiquidFuel_C: "fluid",
      Desc_NitrogenGas_C: "fluid",
    });
  });

  it("skips RF_INVALID and classes with no mForm, and unknown forms", () => {
    const forms = parseItemForms([{ NativeClass: "x", Classes: [{ ClassName: "A", mForm: "RF_INVALID" }, { ClassName: "B" }, { ClassName: "C", mForm: "RF_FUTURE" }] }]);
    expect(forms).toEqual({});
  });

  it.each([{}, "text", null, [{ NativeClass: 1, Classes: [] }], [{ NativeClass: "x" }], [{ NativeClass: "x", Classes: [{ mForm: "RF_SOLID" }] }]])(
    "throws, rather than producing an empty catalog, when the file isn't the expected shape: %j",
    (bad) => {
      expect(() => parseItemForms(bad)).toThrow(/Docs file/);
    },
  );
});

describe("the committed catalog", () => {
  const forms = itemFormCatalog.forms;

  // Spot checks from ADR-0015, taken from the game data on the owner's install.
  it.each([
    ["Desc_LiquidFuel_C", "fluid"],
    ["Desc_LiquidOil_C", "fluid"],
    ["Desc_Water_C", "fluid"],
    ["Desc_NitrogenGas_C", "fluid"],
    ["Desc_PolymerResin_C", "solid"],
    ["Desc_Stator_C", "solid"],
    ["Desc_Plastic_C", "solid"],
  ])("%s is %s", (className, form) => {
    expect(forms[className]).toBe(form);
  });

  it("holds only solid or fluid, for a plausible number of items", () => {
    const values = Object.values(forms);
    expect(values.length).toBeGreaterThan(150);
    expect(values.every((v) => v === "solid" || v === "fluid")).toBe(true);
  });

  it("records where it came from, without a local path", () => {
    const { meta } = itemFormCatalog;
    expect(meta.gameVersion).toMatch(/^\d+(\.\d+)+$/);
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.source).not.toMatch(/[:\\]/);
  });
});

describe("createUnitResolver", () => {
  it("solid -> items/min, liquid -> m3/min, gas -> m3/min", () => {
    const resolve = createUnitResolver(() => {});
    expect(resolve("Desc_Stator_C")).toBe("items/min");
    expect(resolve("Desc_LiquidFuel_C")).toBe("m3/min");
    expect(resolve("Desc_NitrogenGas_C")).toBe("m3/min");
  });

  it("an unknown className is null, and is reported once per className", () => {
    const unknown: string[] = [];
    const resolve = createUnitResolver((className) => unknown.push(className));
    expect([resolve("Desc_Modded_C"), resolve("Desc_Modded_C"), resolve("Desc_Other_C")]).toEqual([null, null, null]);
    resolve("Desc_Modded_C");
    expect(unknown).toEqual(["Desc_Modded_C", "Desc_Other_C"]);
  });

  it("each resolver keeps its own memory (so one per process is the caller's choice)", () => {
    const a: string[] = [];
    const b: string[] = [];
    createUnitResolver((c) => a.push(c))("Desc_X_C");
    createUnitResolver((c) => b.push(c))("Desc_X_C");
    expect([a, b]).toEqual([["Desc_X_C"], ["Desc_X_C"]]);
  });

  it("prototype names never resolve to a unit", () => {
    const resolve = createUnitResolver(() => {});
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(resolve(name), name).toBeNull();
    }
  });

  it("accepts a custom catalog", () => {
    expect(createUnitResolver(() => {}, { Desc_Mod_C: "fluid" })("Desc_Mod_C")).toBe("m3/min");
  });
});
