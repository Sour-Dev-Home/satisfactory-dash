import { describe, expect, it } from "vitest";
import { insertItemSamples, insertPowerSamples, insertTransitions } from "./historyRepository.js";

// Postgres rejects a whole statement for one bad value (integer out of range, a NUL in text, a timestamp out of range).
// A batch is retried as a unit by the recorder, so one such row would block every later row until it aged out of the
// buffer: the repository must drop what the database cannot store, like it already drops NaN.
function recordingDb() {
  const calls: unknown[][] = [];
  return {
    calls,
    db: {
      query: (_text: string, values?: unknown[]) => {
        calls.push(values ?? []);
        return Promise.resolve({ rows: [] });
      },
    },
  };
}

const power = (overrides: Record<string, unknown> = {}) => ({
  session: 7,
  circuit: 1,
  atMs: 1_700_000_000_000,
  productionMW: 1,
  consumptionMW: 1,
  capacityMW: 1,
  batteryPercent: 0,
  fuseTripped: false,
  ...overrides,
});

describe("history repository: rows the database would reject are dropped", () => {
  it("power: a circuit id outside int4 or a non-integer id is dropped, the rest is written", async () => {
    const { db, calls } = recordingDb();
    await insertPowerSamples(db, "s", [power(), power({ circuit: 2 ** 31 }), power({ circuit: 1.5 }), power({ circuit: -1 })]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[2]).toEqual([1, -1]);
  });

  it("power: a timestamp outside the range Postgres can store is dropped", async () => {
    const { db, calls } = recordingDb();
    await insertPowerSamples(db, "s", [power({ atMs: 1e20 })]);
    expect(calls).toHaveLength(0);
  });

  it("items: a name with a NUL character is dropped", async () => {
    const { db, calls } = recordingDb();
    await insertItemSamples(db, "s", [
      { item: "Desc_A\u0000_C", atMs: 1_700_000_000_000, currentPerMinute: 1, maxPerMinute: 1 },
      { item: "Desc_B_C", atMs: 1_700_000_000_000, currentPerMinute: 1, maxPerMinute: 1 },
    ]);
    expect(calls[0]?.[1]).toEqual(["Desc_B_C"]);
  });

  it("transitions: a NUL in any text field is dropped", async () => {
    const { db, calls } = recordingDb();
    const base = { atMs: 1_700_000_000_000, buildingId: "b", className: "C", fromState: null, toState: "producing" };
    await insertTransitions(db, "s", [
      { ...base, buildingId: "b\u0000" },
      { ...base, className: "C\u0000" },
      { ...base, toState: "x\u0000" },
      { ...base, fromState: "y\u0000" },
      base,
    ]);
    expect(calls[0]?.[2]).toEqual(["b"]);
  });
});
