import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POWER_LINES_MAX_ITEMS, PowerLineSchema, PowerLinesLayerDataSchema } from "@satisfactory-dash/shared";
import { powerLinesSample } from "@satisfactory-dash/shared/fixtures";
import { DERIVED_ID_PREFIX, mapPowerLines } from "./powerLinesMapper.js";

// docs-vault/raw-sources/captured-responses: a preamble, a `---` line, then the JSON.
const CAPTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs-vault/raw-sources/captured-responses");

function readCapture(name: string): Record<string, unknown>[] {
  const text = readFileSync(path.join(CAPTURES, name), "utf8").replace(/\r\n/g, "\n");
  return JSON.parse(text.slice(text.indexOf("\n---\n") + 5)) as Record<string, unknown>[];
}

const capture = () => readCapture("frm-getCables-2026-09-27-trimmed.json");

const cable = (over: Record<string, unknown> = {}) => ({
  ID: "Build_PowerLine_C_1",
  Name: "Power Line",
  ClassName: "Build_PowerLine_C",
  location0: { x: 0, y: 0, z: 0 },
  location1: { x: 1000, y: 1000, z: 0 },
  Length: 1414,
  ...over,
});

describe("mapPowerLines on the 2026-09-27 capture (ADR-0038 §1, #330)", () => {
  it("projects both lines to the contract's fixture, sorted by id", () => {
    const { data, dropped } = mapPowerLines(capture());
    expect(dropped).toBe(0);
    expect(PowerLinesLayerDataSchema.safeParse(data).success).toBe(true);
    expect(data).toEqual([...powerLinesSample.data].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  });

  it("is the same for the same game state whatever FRM's order or the fields the layer ignores", () => {
    const raw = capture();
    const once = JSON.stringify(mapPowerLines(raw).data);
    const shuffled = [...raw].reverse().map((c) => ({ ...c, Length: 1, ColorSlot: null, features: undefined, location: undefined }));
    expect(JSON.stringify(mapPowerLines(shuffled).data)).toBe(once);
  });
});

describe("mapPowerLines ids", () => {
  it("keeps FRM's id when the contract can hold it", () => {
    expect(mapPowerLines([cable({ ID: "i".repeat(200) })]).data[0]!.id).toBe("i".repeat(200));
  });

  it("derives a deterministic id for a missing, empty, non-string or over-long id; the line still parses", () => {
    for (const ID of [undefined, "", 42, null, "i".repeat(201)]) {
      const first = mapPowerLines([cable({ ID })]).data[0]!;
      const again = mapPowerLines([cable({ ID })]).data[0]!;
      expect(first.id.startsWith(DERIVED_ID_PREFIX)).toBe(true);
      expect(first.id).toBe(again.id);
      expect(PowerLineSchema.safeParse(first).success).toBe(true);
    }
    const a = mapPowerLines([cable({ ID: undefined })]).data[0]!.id;
    const moved = mapPowerLines([cable({ ID: undefined, location1: { x: 5000, y: 0, z: 0 } })]).data[0]!.id;
    expect(a).not.toBe(moved);
  });
});

describe("mapPowerLines points", () => {
  it("rounds cm to whole metres per end, keeps the ends' order, and keeps a line whose ends round together", () => {
    const { data, dropped } = mapPowerLines([cable({ location0: { x: -180350, y: 149, z: 1 }, location1: { x: 150, y: -151, z: 1 } }), cable({ ID: "short", location0: { x: 10, y: 10 }, location1: { x: 40, y: 49 } })]);
    expect(dropped).toBe(0);
    expect(data).toEqual([
      { id: "Build_PowerLine_C_1", points: [[-1803, 1], [2, -2]] },
      { id: "short", points: [[0, 0], [0, 0]] },
    ]);
    expect(PowerLinesLayerDataSchema.safeParse(data).success).toBe(true);
  });

  it("drops and counts a line without two finite, in-bounds ends; keeps the rest", () => {
    const junk = [
      null,
      "x",
      7,
      [],
      {},
      cable({ location0: undefined }),
      cable({ location1: undefined }),
      cable({ location1: { x: 1 } }),
      cable({ location0: { x: Number.NaN, y: 0 } }),
      cable({ location1: { x: 0, y: Number.NEGATIVE_INFINITY } }),
      cable({ location0: { x: "1", y: 0 } }),
      cable({ location1: { x: 2e8, y: 0 } }),
      cable({ location0: { x: 0, y: -1.5e8 } }),
    ];
    const { data, dropped } = mapPowerLines([...junk, cable({ ID: "ok" })]);
    expect(dropped).toBe(junk.length);
    expect(data).toEqual([{ id: "ok", points: [[0, 0], [10, 10]] }]);
  });

  it("keeps the edge of the contract's bounds", () => {
    const { data, dropped } = mapPowerLines([cable({ location0: { x: 1e8, y: -1e8 }, location1: { x: 1.0000004e8, y: 0 } })]);
    expect(dropped).toBe(0);
    expect(data[0]!.points).toEqual([[1_000_000, -1_000_000], [1_000_000, 0]]);
  });
});

describe("mapPowerLines cap and order", () => {
  it("caps the layer at POWER_LINES_MAX_ITEMS, counting the cut lines, and the rest still parses", () => {
    const many = Array.from({ length: POWER_LINES_MAX_ITEMS + 3 }, (_, i) => cable({ ID: `p${String(i).padStart(6, "0")}` }));
    const { data, dropped } = mapPowerLines(many);
    expect(data).toHaveLength(POWER_LINES_MAX_ITEMS);
    expect(dropped).toBe(3);
    expect(data.at(-1)!.id).toBe(`p${String(POWER_LINES_MAX_ITEMS - 1).padStart(6, "0")}`);
    expect(PowerLinesLayerDataSchema.safeParse(data).success).toBe(true);
  });

  it("keeps duplicate FRM ids as separate lines, in an order that does not depend on FRM's", () => {
    const a = cable({ ID: "dup", location1: { x: 100, y: 0 } });
    const b = cable({ ID: "dup", location1: { x: 200, y: 0 } });
    const fwd = mapPowerLines([a, b]);
    expect(fwd.data).toHaveLength(2);
    expect(mapPowerLines([b, a])).toEqual(fwd);
  });

  it("fuzz: any odd input maps to a layer that parses, with a shuffle-stable result", () => {
    const ids: unknown[] = [undefined, "", "i".repeat(201), "i".repeat(200), 7, "derived-x", "  ", null];
    const ends: unknown[] = [{ x: 0, y: 0 }, { x: 1e300, y: 0 }, { x: "1", y: 0 }, null, undefined, { x: -1e12, y: 5 }, { x: 1.5e8, y: 0 }, { x: -49, y: 51, z: "z" }];
    const raw: unknown[] = [];
    for (const ID of ids) {
      for (const location0 of ends) {
        for (const location1 of ends) raw.push(cable({ ID, location0, location1 }));
      }
    }
    raw.push(null, 3, "x", []);
    const out = mapPowerLines(raw);
    expect(PowerLinesLayerDataSchema.safeParse(out.data).success).toBe(true);
    expect(out.data.length + out.dropped).toBe(raw.length);
    expect(mapPowerLines([...raw].reverse())).toEqual(out);
  });
});
