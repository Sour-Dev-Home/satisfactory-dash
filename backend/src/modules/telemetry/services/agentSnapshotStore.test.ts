import { describe, expect, it } from "vitest";
import { LatestSnapshotStore, type SnapshotPart } from "./agentSnapshotStore.js";

const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

/**
 * #368: CADENCE_KEY[part] became ownValue(CADENCE_KEY, part). `part` is never attacker-controlled
 * today (every caller passes a literal), but the guard also protects against a future SnapshotPart
 * that forgets a CADENCE_KEY entry, or a part name that collides with Object.prototype.
 */
describe("LatestSnapshotStore.read: parts outside CADENCE_KEY", () => {
  it("still reads every real part (status, power, factory, players) with its own cadence", () => {
    const store = new LatestSnapshotStore(() => CADENCE);
    store.record({ reachable: true, observedAtMs: 1, receivedAtMs: 1, status: { sessionName: "s" } as never, power: {} as never, factory: { buildings: [] } as never, players: { available: true, players: [] } as never });
    for (const part of ["status", "power", "factory", "players"] as const) {
      expect(() => store.read(part)).not.toThrow();
    }
  });

  it("throws (not a stray cadence off Object.prototype) for a part name that collides with Object.prototype", () => {
    const store = new LatestSnapshotStore(() => CADENCE);
    store.record({ reachable: true, observedAtMs: 1, receivedAtMs: 1, status: { sessionName: "s" } as never });
    // These are never real SnapshotPart values; only reachable by bypassing the type system, as a
    // future bug (a part added to StoredParts without a matching CADENCE_KEY entry) would.
    for (const bogus of ["constructor", "toString", "hasOwnProperty"]) {
      expect(() => store.read(bogus as SnapshotPart)).toThrow(/no cadence for snapshot part/);
    }
  });

  it("throws upstream_unreachable for an unrecognized part with no stored data at all", () => {
    const store = new LatestSnapshotStore(() => CADENCE);
    store.record({ reachable: true, observedAtMs: 1, receivedAtMs: 1, status: { sessionName: "s" } as never });
    expect(() => store.read("not_a_real_part" as SnapshotPart)).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
  });
});
