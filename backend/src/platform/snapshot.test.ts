import { describe, expect, it } from "vitest";
import { observed, snapshot } from "./snapshot.js";

describe("snapshot", () => {
  it("is now and fresh for data that was just read (request-through, unchanged)", () => {
    const before = Date.now();
    const envelope = snapshot("alpha", { a: 1 });
    expect(envelope).toMatchObject({ serverId: "alpha", stale: false, data: { a: 1 } });
    expect(Date.parse(envelope.observedAt)).toBeGreaterThanOrEqual(before);
  });

  it("uses a reading's own time and staleness when its service marked it with observed()", () => {
    const envelope = snapshot("alpha", observed({ a: 1 }, { observedAt: "2026-09-26T12:00:00.000Z", stale: true }));
    expect(envelope).toMatchObject({ observedAt: "2026-09-26T12:00:00.000Z", stale: true, data: { a: 1 } });
  });

  it("marks a copy, so the stored original stays shared and unmarked", () => {
    const original = { a: 1 };
    const marked = observed(original, { observedAt: "2026-09-26T12:00:00.000Z", stale: true });
    expect(marked).not.toBe(original);
    expect(snapshot("alpha", original).stale).toBe(false);
  });

  it("keeps the mark out of the data: it is not enumerable, so it never reaches a JSON body", () => {
    const marked = observed({ a: 1, list: [1, 2] }, { observedAt: "2026-09-26T12:00:00.000Z", stale: false });
    expect(JSON.stringify(marked)).toBe('{"a":1,"list":[1,2]}');
    expect(Object.keys(marked)).toEqual(["a", "list"]);
    expect({ ...marked }).toEqual({ a: 1, list: [1, 2] });
  });

  it("works for an array too", () => {
    const marked = observed([1, 2, 3], { observedAt: "2026-09-26T12:00:00.000Z", stale: true });
    expect(Array.isArray(marked)).toBe(true);
    expect(marked).toEqual([1, 2, 3]);
    expect(snapshot("alpha", marked).stale).toBe(true);
  });

  it("does not choke on data that is not an object", () => {
    expect(snapshot("alpha", null).stale).toBe(false);
    expect(snapshot("alpha", "text").data).toBe("text");
  });
});
