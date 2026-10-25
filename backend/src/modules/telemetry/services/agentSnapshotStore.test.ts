import { describe, expect, it } from "vitest";
import { snapshot } from "../../../platform/snapshot.js";
import { LatestSnapshotStore, type SnapshotPart } from "./agentSnapshotStore.js";

const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

/** ADR-0052: an unreachable game still serves the last stored parts, stale, with when the outage began. */
describe("LatestSnapshotStore.read while the game is unreachable (ADR-0052)", () => {
  const T0 = Date.parse("2026-10-24T10:00:00.000Z");
  const status = { sessionName: "s" } as never;
  const iso = (ms: number) => new Date(ms).toISOString();
  const reachable = (store: LatestSnapshotStore, at: number) =>
    store.record({ reachable: true, observedAtMs: at, receivedAtMs: at, status, power: { circuits: [] } as never, factory: { buildings: [] } as never });
  const unreachable = (store: LatestSnapshotStore, at: number) => store.record({ reachable: false, observedAtMs: at, receivedAtMs: at });
  const markOf = (store: LatestSnapshotStore, part: SnapshotPart) => snapshot("x", store.read(part));

  it("returns the stored parts stale with the first unreachable time, even when the parts are fresh", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 6000);
    reachable(store, T0 + 5000);
    unreachable(store, T0 + 6000);
    for (const part of ["status", "power", "factory"] as const) {
      expect(markOf(store, part)).toMatchObject({ observedAt: iso(T0 + 5000), stale: true, unreachableSince: iso(T0 + 6000) });
    }
    expect(store.read("status")).toMatchObject({ sessionName: "s" });
  });

  it("keeps the first time across a run of unreachable snapshots", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 60_000);
    reachable(store, T0);
    unreachable(store, T0 + 5000);
    unreachable(store, T0 + 10_000);
    unreachable(store, T0 + 15_000);
    expect(markOf(store, "status").unreachableSince).toBe(iso(T0 + 5000));
  });

  it("clears it when a reachable snapshot arrives, and a later outage gets its own time", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 11_000);
    reachable(store, T0);
    unreachable(store, T0 + 5000);
    reachable(store, T0 + 10_000);
    const back = markOf(store, "status");
    expect(back.unreachableSince).toBeUndefined();
    expect("unreachableSince" in back).toBe(false);
    expect(back.stale).toBe(false);
    unreachable(store, T0 + 20_000);
    expect(markOf(store, "status").unreachableSince).toBe(iso(T0 + 20_000));
  });

  it("still throws upstream_unreachable with no part stored: never reported, or unreachable from the first snapshot", () => {
    const empty = new LatestSnapshotStore(() => CADENCE);
    expect(() => empty.read("status")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
    const never = new LatestSnapshotStore(() => CADENCE);
    unreachable(never, T0);
    expect(() => never.read("status")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
    expect(() => never.read("players", { available: false, players: [] })).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
  });

  it("throws for a part that was never stored while others are served (players when the agent never sent them)", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 6000);
    reachable(store, T0 + 5000);
    unreachable(store, T0 + 6000);
    expect(() => store.read("players")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
  });

  it("a silent agent (no unreachable snapshot) is stale by age only, without unreachableSince", () => {
    const store = new LatestSnapshotStore(() => CADENCE, () => T0 + 60_000);
    reachable(store, T0);
    expect(markOf(store, "status")).toMatchObject({ stale: true });
    expect(markOf(store, "status").unreachableSince).toBeUndefined();
  });
});

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
