import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decodeDocsFile, parseItemForms } from "./parseGameDocs.js";
import { createUnitResolver, itemFormCatalog } from "./itemForms.js";
import { ProductionService } from "./services/productionService.js";

const docs = (...classes: object[]) => [{ NativeClass: "x", Classes: classes }];

describe("parseItemForms odd shapes", () => {
  it("handles empty Classes and empty array", () => {
    expect(parseItemForms([])).toEqual({});
    expect(parseItemForms(docs())).toEqual({});
  });

  it("rejects a non-string ClassName on a class with mForm", () => {
    expect(() => parseItemForms(docs({ ClassName: 5, mForm: "RF_SOLID" }))).toThrow();
  });

  it("does not normalise mForm casing/whitespace (skipped, not guessed)", () => {
    expect(parseItemForms(docs({ ClassName: "A", mForm: "rf_solid" }, { ClassName: "B", mForm: " RF_LIQUID " }))).toEqual({});
  });

  it("FINDING: duplicate ClassName with conflicting forms is silently last-wins", () => {
    const groups = [
      { NativeClass: "a", Classes: [{ ClassName: "Dup", mForm: "RF_SOLID" }] },
      { NativeClass: "b", Classes: [{ ClassName: "Dup", mForm: "RF_LIQUID" }] },
    ];
    // A conflict in game data should fail loudly like other format surprises.
    expect(() => parseItemForms(groups)).toThrow();
  });

  it("does not let __proto__ ClassName pollute the result object", () => {
    const out = parseItemForms(docs({ ClassName: "__proto__", mForm: "RF_SOLID" }));
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).solid).toBeUndefined();
  });

  it("handles a huge Classes list", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => ({ ClassName: `C${i}`, mForm: "RF_GAS" }));
    expect(Object.keys(parseItemForms([{ NativeClass: "x", Classes: many }]))).toHaveLength(200_000);
  });
});

describe("decodeDocsFile odd input", () => {
  it("empty buffer gives empty string", () => {
    expect(decodeDocsFile(Buffer.alloc(0))).toBe("");
  });
  it("decodes UTF-16LE with BOM", () => {
    const b = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('[{"a":1}]', "utf16le")]);
    expect(decodeDocsFile(b)).toBe('[{"a":1}]');
  });
  it("BOM-less UTF-16LE is not silently mis-decoded into parseable text", () => {
    const text = decodeDocsFile(Buffer.from("[]", "utf16le"));
    expect(() => JSON.parse(text)).toThrow();
  });
  it("FINDING: odd-length UTF-16 (truncated mid code unit) is silently accepted", () => {
    const full = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("[]", "utf16le")]);
    const odd = Buffer.concat([full, Buffer.from([0x20])]);
    expect(() => decodeDocsFile(odd)).toThrow();
  });
});

describe("createUnitResolver edge cases", () => {
  it("empty and very long classNames resolve to null and are reported once", () => {
    const warn = vi.fn();
    const r = createUnitResolver(warn, {});
    const long = "x".repeat(100_000);
    expect(r("")).toBeNull();
    expect(r("")).toBeNull();
    expect(r(long)).toBeNull();
    expect(warn.mock.calls.map((c) => (c[0] as string).length)).toEqual([0, 100_000]);
  });

  it("inherited keys do not resolve", () => {
    const r = createUnitResolver(() => {}, { A: "solid" });
    for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect(r(k)).toBeNull();
  });

  it("FINDING: a throwing onUnknown callback breaks the overview (logging must not fail the request)", async () => {
    const r = createUnitResolver(() => {
      throw new Error("logger down");
    }, {});
    const svc = new ProductionService(
      {
        getFactoryBuildings: async () =>
          [
            {
              id: "1", name: "n", className: "c", recipe: null, isProducing: false, isPaused: false,
              outputInventory: [], production: [{ className: "Unknown", ratePerMinute: 1 }],
            },
          ] as never,
      },
      r,
    );
    await expect(svc.getFactoryOverview()).resolves.toBeDefined();
  });

  it("catalog json passes load-time validation and has no prototype-ish keys", () => {
    expect(Object.keys(itemFormCatalog.forms).length).toBeGreaterThan(0);
    expect(Object.keys(itemFormCatalog.forms)).not.toContain("__proto__");
  });
});

describe("update-item-forms script argument handling", () => {
  const script = path.resolve(__dirname, "../../../scripts/update-item-forms.ts");
  const run = (args: string[]) =>
    spawnSync("npx", ["tsx", script, ...args], { encoding: "utf8", shell: true, env: { ...process.env, ITEM_DOCS_PATH: "" } });

  it("FINDING: a positional path WITHOUT --game-version is treated as missing (first arg skipped)", () => {
    const r = run([path.resolve(__dirname, "definitely-not-here.json")]);
    // Expected: gets past arg parsing and fails reading the file (ENOENT), not the usage message.
    expect(r.stderr).not.toContain("Usage:");
    expect(r.stderr).toContain("ENOENT");
  });

  it("nonexistent path with --game-version fails with ENOENT and writes nothing", () => {
    const r = run([path.resolve(__dirname, "definitely-not-here.json"), "--game-version", "1"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("ENOENT");
  });
}, 60_000);
