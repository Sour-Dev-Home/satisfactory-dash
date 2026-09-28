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
