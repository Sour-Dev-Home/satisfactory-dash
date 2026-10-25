import { describe, expect, it, vi } from "vitest";
import { WorldIngestService } from "./worldIngestService.js";

function fakeLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import("pino").Logger;
}

function fakeDb(rows: unknown[] = [{ server_id: "uuid-1" }]) {
  const calls: unknown[][] = [];
  return {
    calls,
    db: { query: (_text: string, values?: unknown[]) => { calls.push(values ?? []); return Promise.resolve({ rows }); } },
  };
}

const validRail = { id: "r1", points: [[0, 0], [1, 1]] };

describe("WorldIngestService", () => {
  it("stores a conforming body and reports unchanged:false (a row was written)", async () => {
    const { db, calls } = fakeDb();
    const service = new WorldIngestService(db, fakeLogger());
    const result = await service.ingest("srv-1", "rails", { observedAt: "2026-09-28T00:00:00.000Z", data: [validRail] });
    expect(result).toEqual({ accepted: true, unchanged: false });
    expect(calls[0]?.[0]).toBe("srv-1");
    expect(calls[0]?.[1]).toBe("rails");
    expect(JSON.parse(calls[0]?.[6] as string)).toEqual([validRail]);
  });

  it("reports unchanged:true when the repository wrote nothing (the hash matched)", async () => {
    const { db } = fakeDb([]); // no rows returned = the WHERE-guarded conflict didn't fire
    const service = new WorldIngestService(db, fakeLogger());
    const result = await service.ingest("srv-1", "rails", { observedAt: "2026-09-28T00:00:00.000Z", data: [validRail] });
    expect(result).toEqual({ accepted: true, unchanged: true });
  });

  it("truncates an over-cap item count, marks truncated, and stores only the surviving items", async () => {
    const { db, calls } = fakeDb();
    const service = new WorldIngestService(db, fakeLogger());
    const many = Array.from({ length: 5_002 }, (_, i) => ({ id: `r${i}`, points: [[0, 0], [1, 1]] }));
    await service.ingest("srv-1", "rails", { observedAt: "2026-09-28T00:00:00.000Z", data: many });
    expect(calls[0]?.[4]).toBe(true); // truncated
    expect(calls[0]?.[5]).toBe(5_000); // count
    expect(JSON.parse(calls[0]?.[6] as string)).toHaveLength(5_000);
  });

  it("stores the trainRoutes layer, caps it at 4,000 records and drops a record with an unknown recordType (conform, don't reject)", async () => {
    const station = (i: number) => ({ recordType: "station", id: `s${i}`, name: "A ", platforms: [{ id: "p", mode: "unload", items: ["Desc_Silica_C"] }] });
    const ingest = async (data: unknown[]) => {
      const { db, calls } = fakeDb();
      await new WorldIngestService(db, fakeLogger()).ingest("srv-1", "trainRoutes", { observedAt: "2026-10-25T00:00:00.000Z", data });
      return calls[0] ?? [];
    };
    const mixed = await ingest([station(1), { recordType: "tram", id: "x" }]);
    expect(mixed[1]).toBe("trainRoutes");
    expect(mixed[5]).toBe(1);
    expect(JSON.parse(mixed[6] as string)).toEqual([station(1)]);
    const over = await ingest(Array.from({ length: 4_001 }, (_, i) => station(i)));
    expect(over[4]).toBe(true);
    expect(over[5]).toBe(4_000);
  });

  it("caps the conveyors layer at its own 50,000 edges, not the shared 5,000 (ADR-0048 amendment)", async () => {
    const edge = (i: number) => ({
      id: `belt-${i}`, kind: "belt", from: "a", fromKind: "machine", to: "b", toKind: "splitter",
      capacityPerMinute: 60, tier: "Conveyor Belt Mk.1", at: { x: 0, y: 0 },
    });
    const ingest = async (n: number) => {
      const { db, calls } = fakeDb();
      await new WorldIngestService(db, fakeLogger()).ingest("srv-1", "conveyors", { observedAt: "2026-10-21T00:00:00.000Z", data: Array.from({ length: n }, (_, i) => edge(i)) });
      return calls[0] ?? [];
    };
    const under = await ingest(5_001);
    expect(under[4]).toBe(false);
    expect(under[5]).toBe(5_001);
    const over = await ingest(50_001);
    expect(over[4]).toBe(true);
    expect(over[5]).toBe(50_000);
  });

  it("stores a conveyors skip as an empty, untruncated row whose hash carries the reason, distinct per reason and from a real reading (#577)", async () => {
    const { db, calls } = fakeDb();
    const service = new WorldIngestService(db, fakeLogger());
    await service.ingest("srv-1", "conveyors", { observedAt: "2026-10-21T00:00:00.000Z", skipped: "tooManyEdges" });
    await service.ingest("srv-1", "conveyors", { observedAt: "2026-10-21T00:00:00.000Z", skipped: "unsupportedFrm" });
    await service.ingest("srv-1", "conveyors", { observedAt: "2026-10-21T00:10:00.000Z", data: [] });
    const [tooMany, unsupported, good] = calls;
    expect(tooMany?.slice(1, 7)).toEqual(["conveyors", "skipped:tooManyEdges", "2026-10-21T00:00:00.000Z", false, 0, "[]"]);
    expect(unsupported?.[2]).toBe("skipped:unsupportedFrm");
    expect(good?.[2]).not.toMatch(/^skipped:/);
  });

  it("refuses a skip for any layer but conveyors", async () => {
    const { db } = fakeDb();
    await expect(new WorldIngestService(db, fakeLogger()).ingest("srv-1", "rails", { observedAt: "2026-10-21T00:00:00.000Z", skipped: "tooManyEdges" })).rejects.toThrow(/conveyors/);
  });

  it("drops (and logs at warn) an item that fails its per-item schema, rather than rejecting the whole ingest", async () => {
    const { db, calls } = fakeDb();
    const logger = fakeLogger();
    const service = new WorldIngestService(db, logger);
    const bad = { id: "bad" }; // no `points`: fails RailSegmentSchema
    await service.ingest("srv-1", "rails", { observedAt: "2026-09-28T00:00:00.000Z", data: [validRail, bad] });
    expect(JSON.parse(calls[0]?.[6] as string)).toEqual([validRail]);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ layer: "rails", serverId: "srv-1", dropped: 1 }), expect.any(String));
  });

  it("never logs at warn when nothing was dropped", async () => {
    const { db } = fakeDb();
    const logger = fakeLogger();
    const service = new WorldIngestService(db, logger);
    await service.ingest("srv-1", "rails", { observedAt: "2026-09-28T00:00:00.000Z", data: [validRail] });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("the SAME surviving data hashes the same regardless of what else was in the raw body (truncated/dropped items don't affect it)", async () => {
    const { db, calls } = fakeDb();
    const service = new WorldIngestService(db, fakeLogger());
    await service.ingest("srv-1", "rails", { observedAt: "2026-09-28T00:00:00.000Z", data: [validRail] });
    const hashA = calls[0]?.[2];
    await service.ingest("srv-1", "rails", { observedAt: "2026-09-28T00:00:01.000Z", data: [validRail, { id: "bad" }] });
    const hashB = calls[1]?.[2];
    expect(hashA).toBe(hashB);
  });
});
