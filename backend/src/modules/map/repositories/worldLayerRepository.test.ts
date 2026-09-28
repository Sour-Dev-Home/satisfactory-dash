import { describe, expect, it } from "vitest";
import { getLatestWorldLayer, upsertWorldLayerIfChanged } from "./worldLayerRepository.js";

function recordingDb(rows: unknown[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  return {
    calls,
    db: {
      query: (text: string, values?: unknown[]) => {
        calls.push({ text, values: values ?? [] });
        return Promise.resolve({ rows });
      },
    },
  };
}

describe("worldLayerRepository", () => {
  it("getLatestWorldLayer sends the server's public id and the layer, and parses a returned row", async () => {
    const { db, calls } = recordingDb([{ hash: "h1", observed_at: "2026-09-28T00:00:00.000Z", truncated: false, count: 2, data: [1, 2] }]);
    const row = await getLatestWorldLayer(db, "srv-1", "rails");
    expect(calls[0]?.values).toEqual(["srv-1", "rails"]);
    expect(row).toEqual({ hash: "h1", observedAt: "2026-09-28T00:00:00.000Z", truncated: false, count: 2, data: [1, 2] });
  });

  it("getLatestWorldLayer returns undefined when no row matches (no data yet, or an unknown/removed server)", async () => {
    const { db } = recordingDb([]);
    expect(await getLatestWorldLayer(db, "srv-1", "rails")).toBeUndefined();
  });

  it("getLatestWorldLayer converts a Date observed_at (a real driver's shape) to ISO", async () => {
    const { db } = recordingDb([{ hash: "h1", observed_at: new Date("2026-09-28T00:00:00.000Z"), truncated: false, count: 0, data: [] }]);
    const row = await getLatestWorldLayer(db, "srv-1", "rails");
    expect(row?.observedAt).toBe("2026-09-28T00:00:00.000Z");
  });

  it("upsertWorldLayerIfChanged sends the data JSON-stringified for the ::jsonb cast", async () => {
    const { db, calls } = recordingDb([{ server_id: "uuid-1" }]);
    const result = await upsertWorldLayerIfChanged(db, "srv-1", "rails", {
      hash: "h2",
      observedAt: "2026-09-28T00:00:00.000Z",
      truncated: false,
      count: 1,
      data: [{ id: "a" }],
    });
    expect(calls[0]?.values).toEqual(["srv-1", "rails", "h2", "2026-09-28T00:00:00.000Z", false, 1, JSON.stringify([{ id: "a" }])]);
    expect(result).toEqual({ written: true });
  });

  it("upsertWorldLayerIfChanged reports written:false when the conflict guard returned no row (an unchanged hash, or an unknown server)", async () => {
    const { db } = recordingDb([]);
    const result = await upsertWorldLayerIfChanged(db, "srv-1", "rails", { hash: "h2", observedAt: "2026-09-28T00:00:00.000Z", truncated: false, count: 0, data: [] });
    expect(result).toEqual({ written: false });
  });
});
